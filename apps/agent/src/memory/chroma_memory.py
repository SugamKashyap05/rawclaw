"""
ChromaDB-backed long-term memory and knowledge store.

This keeps chat/session recall and manually curated knowledge in the same
vector store, with metadata filters for collection, source, and tags.
"""
import json
import logging
import time
from datetime import datetime
from typing import Any, Optional

import chromadb

# Heavy imports moved to lazy loaders

from src.config import settings

logger = logging.getLogger("rawclaw.memory")

CHROMA_HOST = settings.CHROMA_HOST
CHROMA_PORT = settings.CHROMA_PORT


class ChromaMemory:
    """Long-term vector memory using a remote ChromaDB collection."""

    def __init__(self, persist_directory: str, collection_name: str):
        self.persist_directory = persist_directory
        self.collection_name = collection_name
        self.client: Optional[chromadb.HttpClient] = None
        self.collection = None
        self.embedding_model = None
        self._initialize()

    def _initialize(self) -> None:
        """Initialize ChromaDB client. Model is lazy-loaded on first use."""
        try:
            logger.info("Initializing ChromaDB client...")
            self.client = chromadb.HttpClient(
                host=CHROMA_HOST, 
                port=CHROMA_PORT,
                settings=chromadb.config.Settings(
                    chroma_api_impl="rest",
                    timeout_config={"connect": 2.0, "read": 5.0}
                )
            )
            self.client.heartbeat()
            self.collection = self.client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )
            logger.info(
                "Chroma client ready: %s at %s:%s",
                self.collection_name,
                CHROMA_HOST,
                CHROMA_PORT,
            )
        except Exception as error:
            logger.warning("ChromaDB not reached during init (will retry on use): %s", error)
            self.client = None
            self.collection = None

    @property
    def model(self):
        """Lazy-load the embedding model."""
        if self.embedding_model is None:
            logger.info("Loading SentenceTransformer model (all-MiniLM-L6-v2) - this may take a moment...")
            from sentence_transformers import SentenceTransformer
            self.embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
        return self.embedding_model

    def _embed(self, text: str) -> list[float]:
        return self.model.encode(text).tolist()

    def _serialize_tags(self, tags: Optional[list[str]]) -> str:
        return json.dumps(sorted({tag.strip() for tag in (tags or []) if tag and tag.strip()}))

    def _parse_tags(self, raw: Any) -> list[str]:
        if raw is None:
            return []
        if isinstance(raw, list):
            return [str(item) for item in raw if item]
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(item) for item in parsed if item]
            except json.JSONDecodeError:
                pass
            return [tag.strip() for tag in raw.split(",") if tag.strip()]
        return []

    def _build_where(
        self,
        session_id: Optional[str] = None,
        collection: Optional[str] = None,
        source: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        clauses: list[dict[str, Any]] = []
        if session_id:
            clauses.append({"session_id": session_id})
        if collection:
            clauses.append({"collection": collection})
        if source:
            clauses.append({"source": source})
        if not clauses:
            return None
        if len(clauses) == 1:
            return clauses[0]
        return {"$and": clauses}

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict | None = None,
    ) -> None:
        if self.collection is None:
            logger.warning("Chroma collection not available, skipping memory storage")
            return

        try:
            doc_id = f"{session_id}_{int(time.time() * 1000)}_{role}"
            timestamp = datetime.utcnow().isoformat()
            meta = {
                "session_id": session_id,
                "role": role,
                "timestamp": timestamp,
                "collection": "sessions",
                "memory_type": "chat_message",
                "source": "",
                "tags": self._serialize_tags([]),
            }
            if metadata:
                if "tags" in metadata:
                    meta["tags"] = self._serialize_tags(metadata.pop("tags"))
                meta.update(metadata)

            self.collection.add(
                ids=[doc_id],
                embeddings=[self._embed(content)],
                documents=[content],
                metadatas=[meta],
            )
        except Exception as error:
            logger.warning("Failed to add message to memory: %s", error)

    def add_document(
        self,
        content: str,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        collection: str = "default",
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        if self.collection is None:
            raise RuntimeError("Chroma collection is not available")

        doc_id = f"memory_{int(time.time() * 1000)}"
        timestamp = datetime.utcnow().isoformat()
        meta: dict[str, Any] = {
            "collection": collection or "default",
            "memory_type": "knowledge",
            "source": source or "",
            "timestamp": timestamp,
            "tags": self._serialize_tags(tags),
        }
        if metadata:
            if "tags" in metadata:
                meta["tags"] = self._serialize_tags(metadata.pop("tags"))
            meta.update(metadata)

        self.collection.add(
            ids=[doc_id],
            embeddings=[self._embed(content)],
            documents=[content],
            metadatas=[meta],
        )
        return {
          "id": doc_id,
          "content": content,
          "collection": meta["collection"],
          "source": source or None,
          "tags": self._parse_tags(meta.get("tags")),
          "createdAt": timestamp,
          "updatedAt": timestamp,
        }

    def search(
        self,
        query: str,
        session_id: Optional[str] = None,
        n_results: int = 5,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        collection: Optional[str] = None,
    ) -> list[dict]:
        if self.collection is None:
            return []

        try:
            query_limit = max(n_results * 4, n_results)
            results = self.collection.query(
                query_embeddings=[self._embed(query)],
                n_results=query_limit,
                where=self._build_where(session_id=session_id, collection=collection, source=source),
                include=["documents", "metadatas", "distances"],
            )
        except Exception as error:
            logger.warning("Memory search failed: %s", error)
            return []

        requested_tags = {tag.strip().lower() for tag in (tags or []) if tag and tag.strip()}
        formatted: list[dict[str, Any]] = []

        documents = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]

        for index, document in enumerate(documents):
            metadata = metadatas[index] if index < len(metadatas) else {}
            entry_tags = self._parse_tags(metadata.get("tags"))
            if requested_tags and not requested_tags.issubset({tag.lower() for tag in entry_tags}):
                continue

            distance = distances[index] if index < len(distances) else 1.0
            score = max(0.0, 1.0 - float(distance))
            formatted.append(
                {
                    "id": metadata.get("id") or f"memory-{index}",
                    "content": document,
                    "preview": document[:217] + "..." if len(document) > 220 else document,
                    "role": metadata.get("role", "knowledge"),
                    "session_id": metadata.get("session_id", ""),
                    "timestamp": metadata.get("timestamp", ""),
                    "distance": distance,
                    "score": round(score, 4),
                    "source": metadata.get("source") or None,
                    "collection": metadata.get("collection", "default"),
                    "tags": entry_tags,
                    "createdAt": metadata.get("timestamp", ""),
                    "updatedAt": metadata.get("timestamp", ""),
                }
            )

        return formatted[:n_results]

    def get_session_history(self, session_id: str, limit: int = 20) -> list[dict]:
        if self.collection is None:
            return []

        try:
            results = self.collection.get(
                where={"session_id": session_id},
                include=["documents", "metadatas"],
            )
            documents = results.get("documents") or []
            metadatas = results.get("metadatas") or []
            messages = []
            for index, document in enumerate(documents):
                metadata = metadatas[index] if index < len(metadatas) else {}
                messages.append(
                    {
                        "role": metadata.get("role", "unknown"),
                        "content": document,
                        "timestamp": metadata.get("timestamp", ""),
                    }
                )

            messages.sort(key=lambda item: item["timestamp"])
            return messages[-limit:]
        except Exception as error:
            logger.warning("Failed to get session history: %s", error)
            return []

    def get_stats(self) -> dict[str, Any]:
        if self.collection is None:
            return {
                "totalEntries": 0,
                "collections": [],
                "embeddingModel": "all-MiniLM-L6-v2 (offline unavailable)",
            }

        try:
            total_entries = self.collection.count()
            raw = self.collection.get(include=["metadatas"])
            metadatas = raw.get("metadatas") or []
            collections = sorted(
                {
                    str(metadata.get("collection", "default"))
                    for metadata in metadatas
                    if isinstance(metadata, dict)
                }
            )
            return {
                "totalEntries": total_entries,
                "collections": collections,
                "embeddingModel": "all-MiniLM-L6-v2 + ChromaDB + Wikipedia augmentation",
            }
        except Exception as error:
            logger.warning("Failed to get memory stats: %s", error)
            return {
                "totalEntries": 0,
                "collections": [],
                "embeddingModel": "all-MiniLM-L6-v2 (stats unavailable)",
            }

    def clear(self, collection: Optional[str] = None, session_id: Optional[str] = None) -> dict[str, int]:
        if self.collection is None:
            return {"cleared": 0}

        try:
            results = self.collection.get(where=self._build_where(session_id=session_id, collection=collection))
            ids = results.get("ids") or []
            if ids:
                self.collection.delete(ids=ids)
            return {"cleared": len(ids)}
        except Exception as error:
            logger.warning("Failed to clear memory: %s", error)
            return {"cleared": 0}

    def clear_session(self, session_id: str) -> None:
        self.clear(session_id=session_id)

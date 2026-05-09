"""
ChromaDB-backed long-term memory and knowledge store.

This keeps chat/session recall and manually curated knowledge in the same
vector store, with metadata filters for collection, source, and tags.
"""
import json
import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import chromadb

# Heavy imports moved to lazy loaders

from src.config import settings
from src.memory.retrieval_audit import retrieve_with_audit

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

    def _normalize_for_dedupe(self, text: str) -> str:
        return re.sub(r"\s+", " ", str(text or "")).strip().lower()

    def _parse_timestamp(self, value: Any) -> Optional[datetime]:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            normalized = raw.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(normalized)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            return None

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
        doc_id: Optional[str] = None,
    ) -> dict[str, Any]:
        if self.collection is None:
            raise RuntimeError("Chroma collection is not available")

        now = datetime.utcnow().isoformat()
        target_collection = collection or "default"
        requested_tags = self._parse_tags(self._serialize_tags(tags))
        duplicate = self._find_near_duplicate(
            content=content,
            collection=target_collection,
            source=source,
        )

        if duplicate and not doc_id:
            merged_tags = sorted({*duplicate.get("tags", []), *requested_tags})
            duplicate_id = duplicate["id"]
            meta: dict[str, Any] = {
                "collection": target_collection,
                "memory_type": "knowledge",
                "source": source or duplicate.get("source") or "",
                "timestamp": duplicate.get("createdAt") or duplicate.get("updatedAt") or now,
                "tags": self._serialize_tags(merged_tags),
            }
            if metadata:
                metadata_copy = dict(metadata)
                if "tags" in metadata_copy:
                    meta["tags"] = self._serialize_tags(metadata_copy.pop("tags"))
                meta.update(metadata_copy)

            self.collection.upsert(
                ids=[duplicate_id],
                embeddings=[self._embed(content)],
                documents=[content],
                metadatas=[meta],
            )
            return {
                "id": duplicate_id,
                "content": content,
                "collection": target_collection,
                "source": meta["source"] or None,
                "tags": self._parse_tags(meta.get("tags")),
                "createdAt": meta["timestamp"],
                "updatedAt": now,
            }

        resolved_doc_id = doc_id or f"memory_{int(time.time() * 1000)}"
        meta = {
            "collection": target_collection,
            "memory_type": "knowledge",
            "source": source or "",
            "timestamp": now,
            "tags": self._serialize_tags(tags),
        }
        if metadata:
            metadata_copy = dict(metadata)
            if "tags" in metadata_copy:
                meta["tags"] = self._serialize_tags(metadata_copy.pop("tags"))
            meta.update(metadata_copy)

        self.collection.upsert(
            ids=[resolved_doc_id],
            embeddings=[self._embed(content)],
            documents=[content],
            metadatas=[meta],
        )
        return {
          "id": resolved_doc_id,
          "content": content,
          "collection": target_collection,
          "source": meta["source"] or None,
          "tags": self._parse_tags(meta.get("tags")),
          "createdAt": now,
          "updatedAt": now,
        }

    def _find_near_duplicate(
        self,
        *,
        content: str,
        collection: str,
        source: Optional[str] = None,
        threshold: float = 0.95,
        turn_id: str = "memory-maintenance",
    ) -> Optional[dict[str, Any]]:
        if self.collection is None or not content.strip():
            return None

        try:
            _, _, results = retrieve_with_audit(
                collection=self.collection,
                query=content,
                turn_id=turn_id,
                k=5,
                token_limit=8192,
                query_embedding=self._embed(content),
                where=self._build_where(collection=collection, source=source),
                include=["documents", "metadatas", "distances", "ids"],
            )
        except Exception as error:
            logger.warning("Near-duplicate memory check failed: %s", error)
            return None

        documents = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]
        ids = (results.get("ids") or [[]])[0]
        normalized_target = self._normalize_for_dedupe(content)

        for index, document in enumerate(documents):
            metadata = metadatas[index] if index < len(metadatas) else {}
            entry_id = ids[index] if index < len(ids) else None
            if not entry_id:
                continue
            normalized_document = self._normalize_for_dedupe(document)
            distance = distances[index] if index < len(distances) else 1.0
            score = max(0.0, 1.0 - float(distance))
            if normalized_document == normalized_target or score >= threshold:
                return {
                    "id": str(entry_id),
                    "content": str(document or ""),
                    "source": metadata.get("source") or None,
                    "collection": metadata.get("collection", collection),
                    "tags": self._parse_tags(metadata.get("tags")),
                    "createdAt": metadata.get("timestamp", ""),
                    "updatedAt": metadata.get("timestamp", ""),
                    "score": round(score, 4),
                }

        return None

    def search(
        self,
        query: str,
        session_id: Optional[str] = None,
        n_results: int = 5,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        collection: Optional[str] = None,
        turn_id: str = "no-turn-id",
    ) -> list[dict]:
        if self.collection is None:
            return []

        if not (query or "").strip():
            try:
                results = self.collection.get(
                    where=self._build_where(session_id=session_id, collection=collection, source=source),
                    include=["documents", "metadatas"],
                )
            except Exception as error:
                logger.warning("Memory browse failed: %s", error)
                return []

            requested_tags = {tag.strip().lower() for tag in (tags or []) if tag and tag.strip()}
            documents = results.get("documents") or []
            metadatas = results.get("metadatas") or []
            ids = results.get("ids") or []
            formatted: list[dict[str, Any]] = []
            for index, document in enumerate(documents):
                metadata = metadatas[index] if index < len(metadatas) else {}
                entry_tags = self._parse_tags(metadata.get("tags"))
                if requested_tags and not requested_tags.issubset({tag.lower() for tag in entry_tags}):
                    continue
                entry_id = ids[index] if index < len(ids) else f"memory-{index}"
                formatted.append(
                    {
                        "id": str(entry_id),
                        "content": document,
                        "preview": document[:217] + "..." if len(document) > 220 else document,
                        "role": metadata.get("role", "knowledge"),
                        "session_id": metadata.get("session_id", ""),
                        "timestamp": metadata.get("timestamp", ""),
                        "distance": 0.0,
                        "score": 1.0,
                        "source": metadata.get("source") or None,
                        "collection": metadata.get("collection", "default"),
                        "tags": entry_tags,
                        "createdAt": metadata.get("timestamp", ""),
                        "updatedAt": metadata.get("timestamp", ""),
                    }
                )

            formatted.sort(key=lambda item: item.get("updatedAt", ""), reverse=True)
            return formatted[:n_results]

        try:
            query_limit = max(n_results * 4, n_results)
            _, _, results = retrieve_with_audit(
                collection=self.collection,
                query=query,
                turn_id=turn_id,
                k=query_limit,
                token_limit=4096,
                query_embedding=self._embed(query),
                where=self._build_where(session_id=session_id, collection=collection, source=source),
                include=["documents", "metadatas", "distances", "ids"],
            )
        except Exception as error:
            logger.warning("Memory search failed: %s", error)
            return []

        requested_tags = {tag.strip().lower() for tag in (tags or []) if tag and tag.strip()}
        formatted: list[dict[str, Any]] = []

        documents = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]
        ids = (results.get("ids") or [[]])[0]

        for index, document in enumerate(documents):
            metadata = metadatas[index] if index < len(metadatas) else {}
            entry_tags = self._parse_tags(metadata.get("tags"))
            if requested_tags and not requested_tags.issubset({tag.lower() for tag in entry_tags}):
                continue

            distance = distances[index] if index < len(distances) else 1.0
            score = max(0.0, 1.0 - float(distance))
            formatted.append(
                {
                    "id": ids[index] if index < len(ids) else metadata.get("id") or f"memory-{index}",
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
                    "metadata": metadata,
                    "createdAt": metadata.get("timestamp", ""),
                    "updatedAt": metadata.get("timestamp", ""),
                }
            )

        return formatted[:n_results]

    def search_literal(
        self,
        query: str,
        session_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        collection: Optional[str] = None,
        n_results: int = 5,
    ) -> list[dict]:
        """
        Deterministic lexical fallback for exact identifiers and other
        high-signal queries that vector search may miss.
        """
        if self.collection is None:
            return []

        try:
            results = self.collection.get(
                where=self._build_where(session_id=session_id, collection=collection, source=source),
                include=["documents", "metadatas"],
            )
        except Exception as error:
            logger.warning("Literal memory search failed: %s", error)
            return []

        requested_tags = {tag.strip().lower() for tag in (tags or []) if tag and tag.strip()}
        documents = results.get("documents") or []
        metadatas = results.get("metadatas") or []
        ids = results.get("ids") or []

        identifier_tokens = {
            token.upper()
            for token in re.findall(r"\b[A-Z][A-Z0-9_]{2,}\b", query or "")
        }
        query_lower = (query or "").lower()
        query_words = [word for word in re.findall(r"\w+", query_lower) if len(word) > 2]

        ranked: list[dict[str, Any]] = []
        for index, document in enumerate(documents):
            metadata = metadatas[index] if index < len(metadatas) else {}
            entry_tags = self._parse_tags(metadata.get("tags"))
            if requested_tags and not requested_tags.issubset({tag.lower() for tag in entry_tags}):
                continue

            doc_text = str(document or "")
            haystack_lower = doc_text.lower()
            haystack_upper = doc_text.upper()

            score = 0.0
            for token in identifier_tokens:
                if token in haystack_upper:
                    score += 10.0
            if query_lower and query_lower in haystack_lower:
                score += 6.0
            for word in query_words:
                if word in haystack_lower:
                    score += 1.0

            if score <= 0:
                continue

            ranked.append(
                {
                    "id": ids[index] if index < len(ids) else metadata.get("id") or f"literal-memory-{index}",
                    "content": doc_text,
                    "preview": doc_text[:217] + "..." if len(doc_text) > 220 else doc_text,
                    "role": metadata.get("role", "knowledge"),
                    "session_id": metadata.get("session_id", ""),
                    "timestamp": metadata.get("timestamp", ""),
                    "distance": 0.0,
                    "score": round(score, 4),
                    "source": metadata.get("source") or None,
                    "collection": metadata.get("collection", "default"),
                    "tags": entry_tags,
                    "metadata": metadata,
                    "createdAt": metadata.get("timestamp", ""),
                    "updatedAt": metadata.get("timestamp", ""),
                }
            )

        ranked.sort(key=lambda item: item["score"], reverse=True)
        return ranked[:n_results]

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
                "collectionCounts": {},
                "embeddingModel": "all-MiniLM-L6-v2 (offline unavailable)",
                "warnings": [],
            }

        try:
            total_entries = self.collection.count()
            raw = self.collection.get(include=["metadatas"])
            metadatas = raw.get("metadatas") or []
            collection_counts: dict[str, int] = {}
            for metadata in metadatas:
                if not isinstance(metadata, dict):
                    continue
                collection_name = str(metadata.get("collection", "default"))
                collection_counts[collection_name] = collection_counts.get(collection_name, 0) + 1
            collections = sorted(collection_counts.keys())
            warnings: list[str] = []
            if total_entries > 5000:
                warnings.append("Vector memory is large. Review retention and session pruning.")
            for name, count in sorted(collection_counts.items(), key=lambda item: item[1], reverse=True):
                if count > 1000:
                    warnings.append(f'Collection "{name}" is large ({count} entries).')
            return {
                "totalEntries": total_entries,
                "collections": collections,
                "collectionCounts": collection_counts,
                "embeddingModel": "all-MiniLM-L6-v2 + ChromaDB + Wikipedia augmentation",
                "warnings": warnings,
            }
        except Exception as error:
            logger.warning("Failed to get memory stats: %s", error)
            return {
                "totalEntries": 0,
                "collections": [],
                "collectionCounts": {},
                "embeddingModel": "all-MiniLM-L6-v2 (stats unavailable)",
                "warnings": [],
            }

    def dedupe_tool_discovery(self, dry_run: bool = False) -> dict[str, Any]:
        if self.collection is None:
            return {"collection": "tool_discovery", "totalEntries": 0, "duplicatesRemoved": 0, "keptEntries": 0}

        try:
            results = self.collection.get(
                where={"collection": "tool_discovery"},
                include=["documents", "metadatas"],
            )
            ids = results.get("ids") or []
            documents = results.get("documents") or []
            metadatas = results.get("metadatas") or []

            grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for index, entry_id in enumerate(ids):
                metadata = metadatas[index] if index < len(metadatas) else {}
                document = documents[index] if index < len(documents) else ""
                server_name = str(metadata.get("server_name") or metadata.get("source") or "").strip().lower()
                tool_name = str(metadata.get("tool_name") or "").strip().lower()
                if server_name and tool_name:
                    key = f"{server_name}|{tool_name}"
                else:
                    key = f"{server_name}|{self._normalize_for_dedupe(document)}"
                grouped[key].append(
                    {
                        "id": entry_id,
                        "timestamp": self._parse_timestamp(metadata.get("timestamp")) or datetime.min.replace(tzinfo=timezone.utc),
                    }
                )

            ids_to_delete: list[str] = []
            kept_entries = 0
            for entries in grouped.values():
                ordered = sorted(entries, key=lambda item: item["timestamp"], reverse=True)
                kept_entries += 1 if ordered else 0
                ids_to_delete.extend(str(item["id"]) for item in ordered[1:])

            if ids_to_delete and not dry_run:
                self.collection.delete(ids=ids_to_delete)

            return {
                "collection": "tool_discovery",
                "totalEntries": len(ids),
                "duplicatesRemoved": len(ids_to_delete),
                "keptEntries": kept_entries,
                "dryRun": dry_run,
            }
        except Exception as error:
            logger.warning("Failed to dedupe tool discovery memory: %s", error)
            return {"collection": "tool_discovery", "totalEntries": 0, "duplicatesRemoved": 0, "keptEntries": 0, "error": str(error)}

    def prune_sessions(
        self,
        *,
        ttl_days: int = 14,
        max_entries_per_session: int = 100,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        if self.collection is None:
            return {
                "collection": "sessions",
                "totalEntries": 0,
                "deletedEntries": 0,
                "remainingEntries": 0,
                "sessionsTouched": 0,
            }

        try:
            results = self.collection.get(
                where={"collection": "sessions"},
                include=["metadatas"],
            )
            ids = results.get("ids") or []
            metadatas = results.get("metadatas") or []
            cutoff = datetime.now(timezone.utc) - timedelta(days=max(ttl_days, 0))
            by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
            ids_to_delete: list[str] = []
            seen_for_delete: set[str] = set()

            for index, entry_id in enumerate(ids):
                metadata = metadatas[index] if index < len(metadatas) else {}
                session_key = str(metadata.get("session_id") or "unknown")
                timestamp = self._parse_timestamp(metadata.get("timestamp")) or datetime.min.replace(tzinfo=timezone.utc)
                record = {"id": str(entry_id), "timestamp": timestamp}
                by_session[session_key].append(record)
                if timestamp < cutoff and record["id"] not in seen_for_delete:
                    ids_to_delete.append(record["id"])
                    seen_for_delete.add(record["id"])

            for entries in by_session.values():
                ordered = sorted(entries, key=lambda item: item["timestamp"], reverse=True)
                overflow = ordered[max_entries_per_session:]
                for item in overflow:
                    if item["id"] in seen_for_delete:
                        continue
                    ids_to_delete.append(item["id"])
                    seen_for_delete.add(item["id"])

            if ids_to_delete and not dry_run:
                self.collection.delete(ids=ids_to_delete)

            return {
                "collection": "sessions",
                "totalEntries": len(ids),
                "deletedEntries": len(ids_to_delete),
                "remainingEntries": max(0, len(ids) - len(ids_to_delete)),
                "sessionsTouched": len(by_session),
                "ttlDays": ttl_days,
                "maxEntriesPerSession": max_entries_per_session,
                "dryRun": dry_run,
            }
        except Exception as error:
            logger.warning("Failed to prune session recall memory: %s", error)
            return {
                "collection": "sessions",
                "totalEntries": 0,
                "deletedEntries": 0,
                "remainingEntries": 0,
                "sessionsTouched": 0,
                "ttlDays": ttl_days,
                "maxEntriesPerSession": max_entries_per_session,
                "dryRun": dry_run,
                "error": str(error),
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

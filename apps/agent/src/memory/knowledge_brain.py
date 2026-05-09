"""
Knowledge brain that blends internal Chroma recall with Wikipedia retrieval.

Primary sources for this integration:
- LangGraph GitHub: https://github.com/langchain-ai/langgraph
- LangChain community Wikipedia retriever reference:
  https://reference.langchain.com/v0.3/python/community/retrievers/langchain_community.retrievers.wikipedia.WikipediaRetriever.html
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger("rawclaw.knowledge_brain")

CONVERSATIONAL_GLOBAL_COLLECTIONS = ("operator", "mission", "default")


# WikipediaRetriever is lazy-loaded in __init__


class KnowledgeBrain:
    def __init__(self, chroma_memory) -> None:
        self.chroma_memory = chroma_memory
        self.wikipedia = None
        
        # Lazy-load WikipediaRetriever to avoid import hangs
        wikipedia_retriever = None
        try:
            from langchain_community.retrievers import WikipediaRetriever as WR
            wikipedia_retriever = WR
        except Exception as e:
            logger.warning("Could not import WikipediaRetriever: %s", e)

        if wikipedia_retriever:
            try:
                self.wikipedia = wikipedia_retriever(top_k_results=2, doc_content_chars_max=1600)
            except Exception as e:
                logger.warning("Wikipedia retriever disabled because it could not be initialized: %s", e)
                self.wikipedia = None

    def retrieve(
        self,
        query: str,
        session_id: Optional[str] = None,
        collection: Optional[str] = None,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        limit: int = 4,
        turn_id: str = "no-turn-id",
    ) -> dict[str, list[dict[str, Any]]]:
        internal = []
        external = []

        logger.info(f"DEBUG: Retrieving memory for query: '{query}' (session: {session_id})")

        if self.chroma_memory:
            search_specs: list[dict[str, Any]] = []
            if collection:
                search_specs.append({
                    "label": collection,
                    "collection": collection,
                    "session_id": session_id,
                    "source": source,
                })
            else:
                if session_id:
                    search_specs.append({
                        "label": "sessions",
                        "collection": "sessions",
                        "session_id": session_id,
                        "source": None,
                    })
                    search_specs.append({
                        "label": "session",
                        "collection": "session",
                        "session_id": None,
                        "source": f"session:{session_id}",
                    })
                for global_collection in CONVERSATIONAL_GLOBAL_COLLECTIONS:
                    search_specs.append({
                        "label": global_collection,
                        "collection": global_collection,
                        "session_id": None,
                        "source": None,
                    })

            collections_queried: list[str] = []
            stage_counts: dict[str, int] = {}
            seen_ids: set[str] = set()

            for spec in search_specs:
                collections_queried.append(spec["label"])
                literal_hits = self.chroma_memory.search_literal(
                    query=query,
                    session_id=spec["session_id"],
                    collection=spec["collection"],
                    tags=tags,
                    source=spec["source"],
                    n_results=limit,
                )
                semantic_hits = self.chroma_memory.search(
                    query=query,
                    session_id=spec["session_id"],
                    collection=spec["collection"],
                    tags=tags,
                    source=spec["source"],
                    n_results=limit,
                    turn_id=turn_id,
                )
                stage_counts[f'{spec["label"]}:literal'] = len(literal_hits)
                stage_counts[f'{spec["label"]}:semantic'] = len(semantic_hits)

                for item in literal_hits + semantic_hits:
                    item_id = str(item.get("id", ""))
                    if item_id in seen_ids:
                        continue
                    seen_ids.add(item_id)
                    internal.append(item)
                    if len(internal) >= limit:
                        break
                if len(internal) >= limit:
                    break

            logger.info(
                "memory_retrieval turn_id=%s collections_queried=%s entries_returned=%s session_id=%s query=%r stage_counts=%s",
                turn_id,
                collections_queried,
                len(internal),
                session_id,
                query[:160],
                stage_counts,
            )

        if self.wikipedia and query.strip():
            try:
                docs = self.wikipedia.invoke(query.strip())
                for document in docs[:2]:
                    metadata = getattr(document, "metadata", {}) or {}
                    title = metadata.get("title") or metadata.get("source") or "Wikipedia"
                    external.append(
                        {
                            "id": f"wikipedia-{title}".lower().replace(" ", "-"),
                            "content": getattr(document, "page_content", ""),
                            "preview": getattr(document, "page_content", "")[:217] + "...",
                            "score": 0.55,
                            "source": title,
                            "collection": "wikipedia",
                            "tags": ["wikipedia", "external-knowledge"],
                            "createdAt": "",
                            "updatedAt": "",
                        }
                    )
            except Exception as error:
                logger.warning("Wikipedia retrieval failed: %s", error)

        return {"internal": internal, "external": external}

    def build_context(
        self,
        query: str,
        session_id: Optional[str] = None,
        collection: Optional[str] = None,
        tags: Optional[list[str]] = None,
        source: Optional[str] = None,
        turn_id: str = "no-turn-id",
    ) -> str:
        logger.info(f"Building context for query: {query[:50]}...")
        try:
            retrieval = self.retrieve(
                query=query,
                session_id=session_id,
                collection=collection,
                tags=tags,
                source=source,
                turn_id=turn_id,
            )
        except Exception as e:
            logger.error(f"Context retrieval failed globally: {e}")
            return ""

        blocks: list[str] = []
        if retrieval.get("internal"):
            blocks.append("INTERNAL TRUSTED KNOWLEDGE (USE THIS FOR ACCURACY):")
            for item in retrieval["internal"][:4]:
                blocks.append(f"- [{item.get('collection', 'memory')}] {item.get('content', item.get('preview', ''))}")

        if retrieval.get("external"):
            blocks.append("Wikipedia knowledge:")
            for item in retrieval["external"][:2]:
                blocks.append(f"- [{item.get('source', 'Wikipedia')}] {item.get('content', item.get('preview', ''))}")

        context = "\n".join(blocks).strip()
        logger.info(f"DEBUG: Final context block: \n--- START ---\n{context}\n--- END ---")
        logger.info(f"Context built: {len(blocks)} blocks found.")
        return context

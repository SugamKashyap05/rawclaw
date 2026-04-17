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
    ) -> dict[str, list[dict[str, Any]]]:
        internal = []
        external = []

        if self.chroma_memory:
            internal = self.chroma_memory.search(
                query=query,
                session_id=session_id,
                collection=collection,
                tags=tags,
                source=source,
                n_results=limit,
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
    ) -> str:
        retrieval = self.retrieve(
            query=query,
            session_id=session_id,
            collection=collection,
            tags=tags,
            source=source,
        )

        blocks: list[str] = []
        if retrieval["internal"]:
            blocks.append("Internal memory:")
            for item in retrieval["internal"][:4]:
                blocks.append(f"- [{item.get('collection', 'memory')}] {item.get('preview', item.get('content', ''))}")

        if retrieval["external"]:
            blocks.append("Wikipedia knowledge:")
            for item in retrieval["external"][:2]:
                blocks.append(f"- [{item.get('source', 'Wikipedia')}] {item.get('preview', item.get('content', ''))}")

        return "\n".join(blocks).strip()

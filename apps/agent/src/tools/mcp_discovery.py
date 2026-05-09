"""
MCP Discovery — Automatic indexing of MCP tools into ChromaDB for semantic recall.

This ensures that the agent can "discover" and understand how to use new MCP tools
by searching their descriptions in long-term memory.
"""
import json
import logging
from typing import Any, Dict, List, Optional

from src.memory.chroma_memory import ChromaMemory
from src.config import settings

logger = logging.getLogger("rawclaw.mcp.discovery")

class MCPDiscovery:
    """Handles semantic indexing of MCP tools."""

    def __init__(self, memory: Optional[ChromaMemory] = None):
        # If no memory provided, we use the default system memory
        # Note: In a real production app, we'd inject this via a provider.
        self.memory = memory
        self.collection_name = "tool_discovery"

    async def index_tools(self, server_name: str, tools: List[Dict[str, Any]]) -> None:
        """
        Index a list of tools from a specific MCP server.
        Format tool definitions into searchable documents.
        """
        if not self.memory:
            logger.warning("No memory store available for tool indexing")
            return

        logger.info(f"Indexing {len(tools)} tools from MCP server: {server_name}")
        
        for tool in tools:
            name = tool.get("name", "unknown")
            description = tool.get("description", "No description provided.")
            input_schema = tool.get("input_schema", {})
            
            # Create a rich text representation for semantic search
            searchable_content = (
                f"Tool Name: {name}\n"
                f"Server: {server_name}\n"
                f"Description: {description}\n"
                f"Input Schema: {json.dumps(input_schema)}"
            )
            
            # We use the document ID as a compound key to allow updates/idempotency
            doc_id = f"tool_{server_name}_{name}"
            
            try:
                # Add to ChromaDB
                # We use a specific collection 'tool_discovery' to keep it isolated
                self.memory.add_document(
                    content=searchable_content,
                    tags=["mcp", "tool", server_name, name],
                    source=f"mcp://{server_name}",
                    collection=self.collection_name,
                    doc_id=doc_id,
                    metadata={
                        "tool_name": name,
                        "server_name": server_name,
                        "schema": json.dumps(input_schema)
                    }
                )
            except Exception as e:
                logger.error(f"Failed to index tool {name}: {e}")

    async def discover_relevant_tools(self, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        """
        Search for tools relevant to a user query.
        Returns a list of structured tool hints.
        """
        if not self.memory:
            return []

        results = self.memory.search(
            query=query,
            collection=self.collection_name,
            n_results=limit
        )
        
        relevant_tools = []
        for r in results:
            if r.get("score", 0) > 0.6:  # Threshold for relevance
                relevant_tools.append({
                    "name": r["metadata"].get("tool_name"),
                    "server": r["metadata"].get("server_name"),
                    "description": r["content"].split("Description: ")[1].split("\n")[0] if "Description: " in r["content"] else "",
                    "score": r["score"]
                })
        
        return relevant_tools

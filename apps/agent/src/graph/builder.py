"""
LangGraph builder - builds the StateGraph for RawClaw agent.
"""
import logging
from typing import Any, Dict, List, Optional

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage

from src.graph.state import AgentState
from src.graph.tool_adapter import get_all_langchain_tools, get_tool_func
from src.graph.tool_executor import ToolExecutorWithConfirmation
from src.tools.registry import TOOL_REGISTRY
from src.tools.confirmation_gate import ConfirmationGate

logger = logging.getLogger("rawclaw.graph.builder")

_llm_cache: Dict[str, Any] = {}
_checkpointer_cache: Dict[str, Any] = {}


def _get_llm(model_id: str):
    """Get or create an LLM based on model_id."""
    if model_id in _llm_cache:
        return _llm_cache[model_id]

    if model_id.startswith("claude") or "anthropic" in model_id.lower():
        llm = ChatAnthropic(model=model_id)
    elif model_id.startswith("gpt") or "openai" in model_id.lower():
        llm = ChatOpenAI(model=model_id)
    else:
        llm = ChatAnthropic(model="claude-3-sonnet-20240229")

    _llm_cache[model_id] = llm
    return llm


def build_graph(model_id: str, checkpointer=None, confirmation_gate=None) -> StateGraph:
    """Build and compile the agent StateGraph."""
    tools = get_all_langchain_tools()
    logger.info(f"Building graph with {len(tools)} tools")

    llm = _get_llm(model_id)
    llm_with_tools = llm.bind_tools(tools)

    def agent_node(state: AgentState) -> Dict[str, List[BaseMessage]]:
        response = llm_with_tools.invoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state: AgentState) -> str:
        last_msg = state["messages"][-1]
        if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
            return "tools"
        return END

    tool_executor = ToolExecutorWithConfirmation(confirmation_gate or ConfirmationGate())

    async def tool_node_fn(state: AgentState) -> Dict[str, List[ToolMessage]]:
        last_msg = state["messages"][-1]
        tool_calls = getattr(last_msg, "tool_calls", []) or []
        session_id = state.get("session_id", "default")
        
        results = await tool_executor.execute(tool_calls, session_id)
        return {"messages": results}

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node_fn)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    compiled = graph.compile(checkpointer=checkpointer)
    logger.info(f"Graph compiled: {model_id}")
    return compiled
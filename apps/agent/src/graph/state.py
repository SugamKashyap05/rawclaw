"""
LangGraph state definition for RawClaw agent.
"""
from typing import Annotated, Sequence
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    """State for the LangGraph agent workflow."""
    messages: Annotated[Sequence, add_messages]
    session_id: str
    model_id: str
    tool_confirmations_pending: list
    metadata: dict
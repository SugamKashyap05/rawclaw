from src.models.capability_manifest import get_capability, is_eligible
from src.models.router import ModelRouter


def test_small_model_not_eligible_for_tools():
    assert is_eligible("llama3.2:3b", requires_tools=True, complexity="low") is False


def test_small_model_eligible_for_simple_chat():
    assert is_eligible("llama3.2:3b", requires_tools=False, complexity="low") is True


def test_large_model_eligible_for_research():
    assert is_eligible("ollama/gemma4:31b-cloud", requires_tools=True, complexity="high") is True


def test_unknown_model_not_eligible():
    assert is_eligible("mystery-model:latest", requires_tools=False, complexity="low") is False


def test_router_does_not_route_small_model_to_tool_task():
    result = ModelRouter().select_eligible_model(requires_tools=True, complexity="medium")
    cap = get_capability(result)
    assert cap is not None
    assert cap.tool_use is True, f"Router returned {result} which has no tool use"

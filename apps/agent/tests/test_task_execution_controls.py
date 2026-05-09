import pytest

import src.executor as executor_module
from src.contracts.task import AgentTaskDefinition, TaskExecutionRequest
from src.executor import Executor
from src.provenance.trace import ProvenanceTrace


@pytest.mark.asyncio
async def test_task_run_filters_tool_schemas_to_the_definition_allow_list(monkeypatch):
    executor = Executor()
    captured = {}

    async def fake_complete(messages, tools=None):
        captured["tools"] = tools
        if False:
            yield None

    monkeypatch.setattr(executor.model_router, "complete", fake_complete)
    monkeypatch.setattr(
        executor_module.TOOL_REGISTRY,
        "get_schemas",
        lambda: [
            {"type": "function", "function": {"name": "web_search"}},
            {"type": "function", "function": {"name": "read_file"}},
        ],
    )

    result = await executor.run_task(
        TaskExecutionRequest(
            run_id="run-allow-list",
            definition=AgentTaskDefinition(
                id="task-1",
                name="Scoped task",
                description="Only search the web",
                toolIds=["web_search"],
            ),
            context={},
        )
    )

    assert result.status == "done"
    assert [tool["function"]["name"] for tool in captured["tools"]] == ["web_search"]


@pytest.mark.asyncio
async def test_task_run_returns_tool_permission_error_to_the_model_when_a_blocked_tool_is_requested(monkeypatch):
    executor = Executor()
    call_count = {"value": 0}

    async def fake_complete(messages, tools=None):
        call_count["value"] += 1
        if call_count["value"] == 1:
            yield {"type": "tool_call", "tool_call": {"name": "read_file", "arguments": {"path": "README.md"}}}
        else:
            yield {"type": "content", "content": "done"}

    monkeypatch.setattr(executor.model_router, "complete", fake_complete)
    monkeypatch.setattr(
        executor_module.TOOL_REGISTRY,
        "get_schemas",
        lambda: [{"type": "function", "function": {"name": "web_search"}}],
    )

    result = await executor.run_task(
        TaskExecutionRequest(
            run_id="run-blocked-tool",
            definition=AgentTaskDefinition(
                id="task-2",
                name="Scoped task",
                description="Only search the web",
                toolIds=["web_search"],
            ),
            context={},
        )
    )

    assert result.status == "done"
    output_summaries = [step.get("output_summary") for step in (result.provenance or {}).get("steps", [])]
    assert "Tool not permitted for this task." in output_summaries


@pytest.mark.asyncio
async def test_task_run_honors_preexisting_cancellation_before_execution_begins(monkeypatch):
    executor = Executor()
    executor.cancel_task_run("run-cancelled")
    called = {"value": False}

    async def fake_complete(messages, tools=None):
        called["value"] = True
        if False:
            yield None

    monkeypatch.setattr(executor.model_router, "complete", fake_complete)

    result = await executor.run_task(
        TaskExecutionRequest(
            run_id="run-cancelled",
            definition=AgentTaskDefinition(
                id="task-3",
                name="Cancelled task",
                description="Should not start",
                toolIds=[],
            ),
            context={},
        )
    )

    assert result.status == "cancelled"
    assert called["value"] is False


def test_simple_greeting_does_not_receive_automatic_tools():
    executor = Executor()
    tools = [
        {"type": "function", "function": {"name": "web_search", "description": "Search the web"}},
        {"type": "function", "function": {"name": "web_extract", "description": "Read a page"}},
    ]

    selected = executor._select_relevant_tools_for_request("hello jii ki hal chal", tools)

    assert selected == []


def test_conversation_lane_filters_external_retrieval_tools_even_when_selected():
    executor = Executor()
    executor._active_request_execution_intent = {
        "lane": "conversation",
        "retrievalPolicy": {"web": "forbidden", "memory": "forbidden"},
    }
    executor._active_request_chat_controls = {
        "preferredWebMode": "auto",
        "toolUseMode": "limited",
        "permissionMode": "workspace_default",
        "selectedTools": ["skill_grounded-web-summary", "web_search", "read_file"],
        "selectedPlugins": [],
        "planMode": False,
    }
    tools = [
        {"type": "function", "function": {"name": "skill_grounded-web-summary", "description": "Grounded web research"}},
        {"type": "function", "function": {"name": "web_search", "description": "Search the web"}},
        {"type": "function", "function": {"name": "read_file", "description": "Read a local file"}},
    ]

    selected = executor._select_relevant_tools_for_request("How are you?", tools)

    assert [tool["function"]["name"] for tool in selected] == ["read_file"]


def test_conversation_memory_seed_does_not_pick_zero_score_browser_tools():
    executor = Executor()
    executor._active_request_execution_intent = {
        "lane": "conversation",
        "retrievalPolicy": {"web": "forbidden", "memory": "allowed"},
    }
    executor._active_request_chat_controls = {
        "preferredWebMode": "auto",
        "toolUseMode": "auto",
        "permissionMode": "workspace_default",
        "selectedTools": [],
        "selectedPlugins": [],
        "planMode": False,
    }
    tools = [
        {"type": "function", "function": {"name": "browser_close", "description": "Close the browser"}},
        {"type": "function", "function": {"name": "browser_console_messages", "description": "Read browser console logs"}},
        {"type": "function", "function": {"name": "browser_click", "description": "Click in the browser"}},
    ]

    selected = executor._select_relevant_tools_for_request(
        "Please remember that my favorite snack is samosa and I live in Pune.",
        tools,
    )

    assert selected == []


def test_explicit_empty_requested_tools_do_not_fallback_to_registry():
    executor = Executor()

    resolved = executor._resolve_requested_tools_schema([])

    assert resolved == []


def test_agent_invariant_checker_obeys_supplied_policy_without_rederiving():
    executor = Executor()
    executor._active_request_execution_intent = {
        "lane": "conversation",
        "retrievalPolicy": {"web": "forbidden", "memory": "allowed"},
    }
    tools = [
        {"type": "function", "function": {"name": "web_search", "description": "Search the web"}},
        {"type": "function", "function": {"name": "read_file", "description": "Read a local file"}},
    ]

    selected = executor._select_relevant_tools_for_request("search latest election results", tools)

    assert selected == []


def test_conversation_truthfulness_strips_unsupported_records_claims():
    executor = Executor()
    trace = ProvenanceTrace()
    trace.metadata["assistantLane"] = "conversation"
    trace.metadata["memoryRecallOccurred"] = False

    cleaned = executor._enforce_conversation_truthfulness(
        '- I am doing well, thank you for asking!\n- If you are referring to the "How are you?" initiative mentioned in my records, it is a public program.\n- Otherwise, I am ready to help.',
        "How are you?",
        type("Req", (), {"promptProvenance": {"assistantLane": "conversation"}})(),
        trace,
    )

    assert "mentioned in my records" not in cleaned.lower()
    assert "I am doing well" in cleaned

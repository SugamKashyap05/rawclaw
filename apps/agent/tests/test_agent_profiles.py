from pathlib import Path

from src.agents import AgentProfile, AgentProfileResolutionError, AgentProfileStore


def test_profile_store_resolves_default_main_profile():
    store = AgentProfileStore(workspace_root="E:/workspace/rawclaw")

    resolved = store.resolve(None)

    assert resolved.profile.id == "main"
    assert resolved.profile.name == "Main"
    assert Path(resolved.workspace_path) == Path("E:/workspace/rawclaw")


def test_profile_store_resolves_registered_profile():
    store = AgentProfileStore(workspace_root="E:/workspace/rawclaw")
    store.register(
        AgentProfile(
            id="researcher",
            name="Researcher",
            workspace_id="proj-a",
            workspace_path="E:/workspace/rawclaw",
            default_model="ollama/llama3:8b",
            allowed_tools=["web_search", "web_extract"],
            memory_scope="workspace",
            prompt_files=[],
            research_defaults={"style": "grounded"},
            active=True,
        )
    )

    resolved = store.resolve("researcher")

    assert resolved.profile.id == "researcher"
    assert resolved.model_id == "ollama/llama3:8b"
    assert resolved.allowed_tools == ["web_search", "web_extract"]


def test_profile_store_rejects_unknown_profile():
    store = AgentProfileStore(workspace_root="E:/workspace/rawclaw")

    try:
        store.resolve("ghost")
    except AgentProfileResolutionError as exc:
        assert "ghost" in str(exc)
    else:
        raise AssertionError("Expected unknown agent resolution to fail")

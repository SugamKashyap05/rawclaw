import pytest

from src.config import settings
from src.models.base import ProviderHealth
from src.models.router import ModelRouter
from src.models.providers.ollama import OllamaProvider


class FakeOllamaProvider:
    def __init__(self):
        self.calls: list[tuple[str, bool]] = []

    async def complete(self, messages, options=None):
        model = (options or {}).get("model")
        has_tools = bool((options or {}).get("tools"))
        self.calls.append((model, has_tools))
        if model == "chatless-tools:1b":
            if has_tools:
                yield {
                    "type": "error",
                    "error": "provider_http_error",
                    "message": 'Ollama returned 400: {"error":"\\"chatless-tools:1b\\" does not support chat"}',
                }
                return
            yield {
                "type": "content",
                "content": "Recovered on the selected chatless model without tools.",
            }
            return

        if model == "gemma4:31b-cloud":
            yield {
                "type": "content",
                "content": "Recovered on eligible routed model.",
            }
            return

        if model == "gemma4:e4b":
            yield {
                "type": "content",
                "content": "Recovered on simple local model.",
            }
            return

        yield {
            "type": "error",
            "error": "provider_http_error",
            "message": f"Unexpected model {model}",
        }

    async def health(self):
        return ProviderHealth(status="ok")

    async def list_models(self):
        return []

    def has_native_thinking(self, model_id: str) -> bool:
        return False


class FakeShowResponse:
    def __init__(self, status_code: int, data: dict):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


class FakeShowClient:
    def __init__(self, responses: list[FakeShowResponse]):
        self._responses = responses
        self.calls: list[tuple[str, dict]] = []

    async def post(self, url: str, json=None):
        self.calls.append((url, json or {}))
        if self._responses:
            return self._responses.pop(0)
        return FakeShowResponse(404, {"error": "not found"})


@pytest.mark.asyncio
async def test_router_reroutes_unknown_explicit_model_to_manifest_eligible_model(monkeypatch):
    router = ModelRouter()
    provider = FakeOllamaProvider()
    router.providers = {"ollama": provider}

    chunks = [
        chunk
        async for chunk in router.complete(
            [{"role": "user", "content": "Say hello."}],
            model="ollama/qwen2.5:1.5b",
        )
    ]

    assert provider.calls == [("gemma4:e4b", False)]
    assert any(
        chunk.get("content") == "Recovered on simple local model."
        for chunk in chunks
        if isinstance(chunk, dict)
    )


@pytest.mark.asyncio
async def test_router_prevents_small_non_tool_model_from_receiving_tool_task(monkeypatch):
    router = ModelRouter()
    provider = FakeOllamaProvider()
    router.providers = {"ollama": provider}

    chunks = [
        chunk
        async for chunk in router.complete(
            [{"role": "user", "content": "hello jii ki hal chal"}],
            model="ollama/gemma4:e4b",
            tools=[{"type": "function", "function": {"name": "web_search"}}],
            complexity="medium",
        )
    ]

    assert provider.calls == [("gemma4:31b-cloud", True)]
    assert not [chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "error"]
    assert any(
        chunk.get("content") == "Recovered on eligible routed model."
        for chunk in chunks
        if isinstance(chunk, dict)
    )

    metadata = next(chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "metadata")
    assert metadata["metadata"]["modelId"] == "ollama/gemma4:31b-cloud"
    assert metadata["metadata"]["fallbacks"] == []


@pytest.mark.asyncio
async def test_router_uses_simple_local_model_for_low_complexity_chat(monkeypatch):
    router = ModelRouter()
    provider = FakeOllamaProvider()
    router.providers = {"ollama": provider}

    chunks = [
        chunk
        async for chunk in router.complete(
            [{"role": "user", "content": "Say hello."}],
            complexity="low",
        )
    ]

    assert provider.calls == [("gemma4:e4b", False)]
    assert not [chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "error"]
    assert any(
        chunk.get("content") == "Recovered on simple local model."
        for chunk in chunks
        if isinstance(chunk, dict)
    )
    metadata = next(chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "metadata")
    assert metadata["metadata"]["modelId"] == "ollama/gemma4:e4b"
    assert metadata["metadata"]["fallbacks"] == []


@pytest.mark.asyncio
async def test_router_can_retry_same_eligible_model_without_tools_when_provider_rejects_chat(monkeypatch):
    router = ModelRouter()
    provider = FakeOllamaProvider()
    router.providers = {"ollama": provider}

    chunks = [
        chunk
        async for chunk in router.complete(
            [{"role": "user", "content": "Search for the latest election result."}],
            model="ollama/chatless-tools:1b",
            tools=[{"type": "function", "function": {"name": "web_search"}}],
        )
    ]

    assert provider.calls == [("gemma4:31b-cloud", True)]
    assert not [chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "error"]
    assert any(chunk.get("content") == "Recovered on eligible routed model." for chunk in chunks if isinstance(chunk, dict))

    metadata = next(chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "metadata")
    assert metadata["metadata"]["modelId"] == "ollama/gemma4:31b-cloud"
    assert metadata["metadata"]["fallbacks"] == []


@pytest.mark.asyncio
async def test_ollama_cloud_models_are_treated_as_chat_capable_without_show_probe():
    provider = OllamaProvider()
    client = FakeShowClient([])

    supported = await provider._model_supports_chat(client, "gemma4:31b-cloud")

    assert supported is True
    assert client.calls == []


@pytest.mark.asyncio
async def test_ollama_show_capabilities_can_mark_chat_support():
    provider = OllamaProvider()
    client = FakeShowClient([
        FakeShowResponse(
            200,
            {
                "capabilities": ["completion", "thinking", "tools", "vision"],
            },
        )
    ])

    supported = await provider._model_supports_chat(client, "gemma4:31b")

    assert supported is True
    assert client.calls == [("http://localhost:11434/api/show", {"name": "gemma4:31b"})]

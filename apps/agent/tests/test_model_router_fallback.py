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
        if model == "qwen2.5:1.5b":
            yield {
                "type": "error",
                "error": "provider_http_error",
                "message": 'Ollama returned 400: {"error":"\\"qwen2.5:1.5b\\" does not support chat"}',
            }
            return

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

        if model == "phi3:3.8b":
            yield {
                "type": "content",
                "content": "Recovered on fallback model.",
            }
            return

        if model == "deepseek-r1:8b":
            if has_tools:
                yield {
                    "type": "error",
                    "error": "provider_http_error",
                    "message": 'Ollama returned 400: {"error":"registry.ollama.ai/library/deepseek-r1:8b does not support tools"}',
                }
                return
            yield {
                "type": "content",
                "content": "Recovered on the selected model without tools.",
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
async def test_router_surfaces_explicit_model_incompatibility_without_cross_model_fallback(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_LOW_MODEL", "ollama/qwen2.5:1.5b", raising=False)
    monkeypatch.setattr(
        settings,
        "OLLAMA_FALLBACK_ORDER",
        ["ollama/qwen2.5:1.5b", "ollama/phi3:3.8b"],
        raising=False,
    )

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

    assert provider.calls == [("qwen2.5:1.5b", False)]
    error = next(chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "error")
    assert error["error"] == "provider_http_error"
    assert "does not support chat" in error["message"]


@pytest.mark.asyncio
async def test_router_retries_the_selected_model_without_tools_before_falling_through(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_LOW_MODEL", "ollama/qwen2.5:1.5b", raising=False)
    monkeypatch.setattr(
        settings,
        "OLLAMA_FALLBACK_ORDER",
        ["ollama/qwen2.5:1.5b", "ollama/phi3:3.8b"],
        raising=False,
    )

    router = ModelRouter()
    provider = FakeOllamaProvider()
    router.providers = {"ollama": provider}

    chunks = [
        chunk
        async for chunk in router.complete(
            [{"role": "user", "content": "hello jii ki hal chal"}],
            model="ollama/deepseek-r1:8b",
            tools=[{"type": "function", "function": {"name": "web_search"}}],
        )
    ]

    assert provider.calls == [("deepseek-r1:8b", True), ("deepseek-r1:8b", False)]
    assert not [chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "error"]
    assert any(
        chunk.get("content") == "Recovered on the selected model without tools."
        for chunk in chunks
        if isinstance(chunk, dict)
    )

    metadata = next(chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "metadata")
    assert metadata["metadata"]["modelId"] == "ollama/deepseek-r1:8b"
    assert metadata["metadata"]["fallbacks"] == []


@pytest.mark.asyncio
async def test_router_retries_same_model_without_tools_when_chat_capability_is_missing(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_LOW_MODEL", "ollama/chatless-tools:1b", raising=False)
    monkeypatch.setattr(
        settings,
        "OLLAMA_FALLBACK_ORDER",
        ["ollama/chatless-tools:1b", "ollama/phi3:3.8b"],
        raising=False,
    )

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

    assert provider.calls == [("chatless-tools:1b", True), ("chatless-tools:1b", False)]
    assert not [chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "error"]
    assert any(
        chunk.get("content") == "Recovered on the selected chatless model without tools."
        for chunk in chunks
        if isinstance(chunk, dict)
    )
    metadata = next(chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "metadata")
    assert metadata["metadata"]["modelId"] == "ollama/chatless-tools:1b"
    assert metadata["metadata"]["fallbacks"] == []


@pytest.mark.asyncio
async def test_router_can_still_fall_through_for_non_explicit_complexity_routing(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_LOW_MODEL", "ollama/qwen2.5:1.5b", raising=False)
    monkeypatch.setattr(
        settings,
        "OLLAMA_FALLBACK_ORDER",
        ["ollama/qwen2.5:1.5b", "ollama/phi3:3.8b"],
        raising=False,
    )
    monkeypatch.setattr(settings, "DEFAULT_MEDIUM_MODEL", "ollama/qwen2.5:1.5b", raising=False)
    monkeypatch.setattr(settings, "DEFAULT_HIGH_MODEL", "ollama/qwen2.5:1.5b", raising=False)

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

    assert provider.calls == [("qwen2.5:1.5b", False), ("phi3:3.8b", False)]
    assert not [chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "error"]
    assert any(chunk.get("content") == "Recovered on fallback model." for chunk in chunks if isinstance(chunk, dict))

    metadata = next(chunk for chunk in chunks if isinstance(chunk, dict) and chunk.get("type") == "metadata")
    assert metadata["metadata"]["modelId"] == "ollama/phi3:3.8b"
    assert metadata["metadata"]["fallbacks"] == ["ollama/qwen2.5:1.5b"]


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

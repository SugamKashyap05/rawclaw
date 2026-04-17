import httpx
import json
from typing import AsyncIterator, List, Dict, Any
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.config import settings

class OllamaProvider(ModelProvider):
    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL

    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[Any]:
        model = options.get("model", "llama3") if options else "llama3"
        tools = options.get("tools") if options else None

        # Convert messages to prompt format for Ollama /api/generate endpoint
        prompt = self._convert_messages_to_prompt(messages)

        payload = {
            "model": model,
            "prompt": prompt,
            "stream": True
        }
        if tools:
            # Note: Ollama /api/generate doesn't natively support tools
            # This would need a different approach if tool calling is required
            pass

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/generate",
                json=payload
            ) as response:
                if response.status_code != 200:
                    yield {
                        "type": "error",
                        "error": "provider_failure",
                        "message": f"Ollama returned {response.status_code}"
                    }
                    return

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)

                        # Handle text content
                        if "response" in chunk and chunk["response"]:
                            yield chunk["response"]

                        # Handle tool calls (Ollama doesn't natively support tool calls in /api/generate)
                        # This would need to be handled differently if tool calling is required

                        if chunk.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue

    def _convert_messages_to_prompt(self, messages: List[Dict[str, Any]]) -> str:
        """Convert chat messages to a single prompt string for Ollama /api/generate endpoint."""
        prompt_parts = []

        for message in messages:
            role = message.get("role", "user")
            content = message.get("content", "")

            if role == "system":
                prompt_parts.append(f"System: {content}")
            elif role == "user":
                prompt_parts.append(f"User: {content}")
            elif role == "assistant":
                prompt_parts.append(f"Assistant: {content}")
            elif role == "tool":
                prompt_parts.append(f"Tool: {content}")
            else:
                prompt_parts.append(f"{role.title()}: {content}")

        # Add the assistant prefix for the next response
        prompt_parts.append("Assistant: ")

        return "\n".join(prompt_parts)

    async def health(self) -> ProviderHealth:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                if res.status_code == 200:
                    return ProviderHealth(status="ok")
                return ProviderHealth(status="error", error=f"Status {res.status_code}")
        except Exception as e:
            return ProviderHealth(status="down", error=str(e))

    async def list_models(self) -> List[ModelInfo]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                if res.status_code != 200:
                    return []
                data = res.json()
                models = []
                for m in data.get("models", []):
                    name = m.get("name")
                    models.append(ModelInfo(
                        id=f"ollama/{name}",
                        name=name,
                        provider="ollama"
                    ))
                return models
        except Exception:
            return []

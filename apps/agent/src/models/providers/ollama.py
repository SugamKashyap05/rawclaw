import httpx
import json
from typing import AsyncIterator, List, Dict, Any
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.config import settings

class OllamaProvider(ModelProvider):
    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL

    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[str]:
        model = options.get("model", "llama3") if options else "llama3"
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", 
                f"{self.base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True
                }
            ) as response:
                if response.status_code != 200:
                    yield f"Error: Ollama returned {response.status_code}"
                    return

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        if "message" in chunk and "content" in chunk["message"]:
                            yield chunk["message"]["content"]
                        if chunk.get("done"):
                            break
                    except json.JSONDecodeError:
                        continue

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

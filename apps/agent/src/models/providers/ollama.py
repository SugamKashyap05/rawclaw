import httpx
import json
import logging
import re
from typing import AsyncIterator, List, Dict, Any, Optional
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.config import settings

logger = logging.getLogger("rawclaw.ollama")


from src.models.tool_parser import extract_textual_tool_calls, TextualToolParser


class OllamaProvider(ModelProvider):
    def __init__(self):
        # NOTE: Verification has confirmed that models with '-cloud' or ':cloud' suffixes 
        # (e.g. qwen3-coder:480b-cloud) are handled as virtual models by the local Ollama 
        # daemon. They are accessible via the standard /api/chat endpoint.
        self.base_url = settings.OLLAMA_BASE_URL

    def has_native_thinking(self, model_id: str) -> bool:
        """
        Detects if the model has native thinking capabilities (e.g., DeepSeek R1).
        Ollama models like deepseek-r1 output <think> blocks.
        """
        mid_lower = model_id.lower()
        # Heuristics for reasoning models
        # r1 models are the most prominent native thinkers in Ollama
        logic_keywords = [
            "deepseek-r1", "-r1", "reasoning", "thought", "logic", 
            "phi-4", "o1", "o3", "thinking", "qwen-2.5-coder" # Qwen coder often reasons in tags
        ]
        return any(kw in mid_lower for kw in logic_keywords)

    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[Any]:
        # Default to low model suffix if no model specified
        default_model = settings.DEFAULT_LOW_MODEL.split('/')[-1]
        model = options.get("model", default_model) if options else default_model
        tools = options.get("tools") if options else None

        # Prepare messages for Ollama /api/chat
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {}
        }

        if options.get("temperature") is not None:
            payload["options"]["temperature"] = options["temperature"]
        if options.get("top_p") is not None:
            payload["options"]["top_p"] = options["top_p"]

        if tools:
            # Ollama /api/chat supports tools in newer versions (0.2.8+)
            # Pass tools to the model for native function calling support
            payload["tools"] = tools
            logger.info(f"[TOOL_TRACE] Ollama sending {len(tools)} tools to model {model}")
            logger.info(f"[TOOL_TRACE] Tool names: {[t.get('function', {}).get('name', 'unknown') for t in tools]}")
        else:
            logger.info(f"[TOOL_TRACE] Ollama: NO tools provided to model {model}")

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/api/chat",
                    json=payload
                ) as response:
                    if response.status_code != 200:
                        error_detail_raw = await response.aread()
                        error_detail = error_detail_raw.decode()
                        
                        error_type = "provider_http_error"
                        # Heuristic: detect context length/prompt too long errors
                        if "too long" in error_detail.lower() or "context" in error_detail.lower():
                            error_type = "context_limit_exceeded"
                            
                        yield {
                            "type": "error",
                            "error": error_type,
                            "message": f"Ollama returned {response.status_code}: {error_detail}"
                        }
                        return

                    parser = TextualToolParser()
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)

                            # Handle native tool calls from Ollama (message.tool_calls)
                            if "message" in chunk and "tool_calls" in chunk["message"]:
                                tool_calls = chunk["message"]["tool_calls"]
                                for tc in tool_calls:
                                    func = tc.get("function", {})
                                    tool_name = func.get("name", "")
                                    if tool_name:
                                        yield {
                                            "type": "tool_call",
                                            "tool_call": {
                                                "name": tool_name,
                                                "arguments": func.get("arguments", {}),
                                            }
                                        }

                            # Handle mixed content/textual tool calls via the parser
                            if "message" in chunk and "content" in chunk["message"]:
                                content = chunk["message"]["content"]
                                if content:
                                    async for event in parser.ingest(content):
                                        if event["type"] == "content":
                                            yield event["content"]
                                        else:
                                            yield event

                            if chunk.get("done"):
                                async for event in parser.flush():
                                    if event["type"] == "content":
                                        yield event["content"]
                                    else:
                                        yield event
                                break
                        except json.JSONDecodeError:
                            continue
            except httpx.ConnectError:
                yield {
                    "type": "error",
                    "error": "provider_offline",
                    "message": "Ollama service is not reachable. Ensure it is running locally."
                }
            except Exception as e:
                yield {
                    "type": "error",
                    "error": "provider_exception",
                    "message": str(e)
                }


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
                        provider="ollama",
                        supports_thinking=self.has_native_thinking(name)
                    ))
                return models
        except Exception:
            return []

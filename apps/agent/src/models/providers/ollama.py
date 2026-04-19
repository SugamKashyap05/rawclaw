import httpx
import json
import re
from typing import AsyncIterator, List, Dict, Any, Optional
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.config import settings


def _extract_textual_tool_calls(content: str) -> tuple[str, List[Dict[str, Any]]]:
    """
    Extract textual tool-call markup from model output.

    Some models emit tool calls as text markup like:
    - <minimax:tool_call>{"name": "web_search", "arguments": {...}}</minimax:tool_call>
    - <invoke name="web_search">...</invoke>
    - <tool>web_search</tool>

    Returns: (cleaned_content, list of tool_call dicts)
    """
    if not content or not isinstance(content, str):
        return content, []

    tool_calls = []
    cleaned = content

    # Pattern 1: <minimax:tool_call>{"name": "...", "arguments": {...}}</minimax:tool_call>
    # Pattern 2: <minimax:tool_call>{"function": {"name": "...", "arguments": {...}}}</minimax:tool_call>
    minimax_pattern = r'<minimax:tool_call>(.*?)</minimax:tool_call>'
    for match in re.finditer(minimax_pattern, content, re.DOTALL):
        try:
            data = json.loads(match.group(1))
            # Handle both formats
            if "name" in data:
                tool_calls.append({
                    "name": data.get("name", ""),
                    "arguments": data.get("arguments", {})
                })
            elif "function" in data:
                func = data["function"]
                tool_calls.append({
                    "name": func.get("name", ""),
                    "arguments": func.get("arguments", {})
                })
            # Remove from cleaned content
            cleaned = cleaned.replace(match.group(0), "")
        except (json.JSONDecodeError, AttributeError):
            pass

    # Pattern 3: <invoke name="..."><parameter name="...">...</parameter>...</invoke>
    invoke_pattern = r'<invoke\s+name="([^"]+)"[^>]*>(.*?)</invoke>'
    for match in re.finditer(invoke_pattern, content, re.DOTALL):
        try:
            tool_name = match.group(1)
            inner = match.group(2)
            # Extract parameters
            args = {}
            param_pattern = r'<parameter\s+name="([^"]+)"[^>]*>(.*?)</parameter>'
            for pmatch in re.finditer(param_pattern, inner, re.DOTALL):
                args[pmatch.group(1)] = pmatch.group(2).strip()

            tool_calls.append({
                "name": tool_name,
                "arguments": args
            })
            cleaned = cleaned.replace(match.group(0), "")
        except (AttributeError, IndexError):
            pass

    # Pattern 4: <tool_call>{"name": "...", "arguments": {...}}</tool_call> (generic)
    generic_pattern = r'<tool_call>(.*?)</tool_call>'
    for match in re.finditer(generic_pattern, content, re.DOTALL):
        try:
            data = json.loads(match.group(1))
            if "name" in data:
                tool_calls.append({
                    "name": data.get("name", ""),
                    "arguments": data.get("arguments", {})
                })
            cleaned = cleaned.replace(match.group(0), "")
        except (json.JSONDecodeError, AttributeError):
            pass

    # Pattern 5: <tool>name</tool> with arguments in various formats
    tool_pattern = r'<tool>([^<]+)</tool>'
    for match in re.finditer(tool_pattern, content, re.DOTALL):
        try:
            tool_name = match.group(1).strip()
            # Look for following arguments in various formats
            tool_calls.append({
                "name": tool_name,
                "arguments": {}
            })
            cleaned = cleaned.replace(match.group(0), "")
        except AttributeError:
            pass

    return cleaned.strip(), tool_calls


class OllamaProvider(ModelProvider):
    def __init__(self):
        # NOTE: Verification has confirmed that models with '-cloud' or ':cloud' suffixes 
        # (e.g. qwen3-coder:480b-cloud) are handled as virtual models by the local Ollama 
        # daemon. They are accessible via the standard /api/chat endpoint.
        self.base_url = settings.OLLAMA_BASE_URL

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

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)

                            # Handle tool calls from Ollama
                            # Ollama returns tool calls in message.tool_calls
                            if "message" in chunk and "tool_calls" in chunk["message"]:
                                tool_calls = chunk["message"]["tool_calls"]
                                if tool_calls:
                                    for tc in tool_calls:
                                        # Ollama format: {"function": {"name": "...", "arguments": {...}}}
                                        func = tc.get("function", {})
                                        tool_name = func.get("name", "")
                                        arguments = func.get("arguments", {})
                                        if tool_name:
                                            yield {
                                                "type": "tool_call",
                                                "tool_call": {
                                                    "name": tool_name,
                                                    "arguments": arguments,
                                                }
                                            }

                            # Handle content - also check for textual tool-call markup
                            if "message" in chunk and "content" in chunk["message"]:
                                content = chunk["message"]["content"]
                                if content:
                                    # Check for textual tool-call markup in content
                                    cleaned_content, textual_tool_calls = _extract_textual_tool_calls(content)

                                    # Yield any textual tool calls found
                                    for tc in textual_tool_calls:
                                        if tc.get("name"):
                                            yield {
                                                "type": "tool_call",
                                                "tool_call": {
                                                    "name": tc["name"],
                                                    "arguments": tc.get("arguments", {}),
                                                }
                                            }

                                    # Yield cleaned content (without tool markup)
                                    if cleaned_content:
                                        yield cleaned_content

                            if chunk.get("done"):
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
                        provider="ollama"
                    ))
                return models
        except Exception:
            return []

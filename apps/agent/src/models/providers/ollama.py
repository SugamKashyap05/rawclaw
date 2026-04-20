import httpx
import json
import logging
import re
from typing import AsyncIterator, List, Dict, Any, Optional
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.config import settings

logger = logging.getLogger("rawclaw.ollama")


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

    # Pattern 6: <tool_code> { tool => '...', args => '...' } </tool_code>
    # This handles formats seen in models like Qwen or Claude-lite that use hash syntax inside tags.
    # Handles multi-line args with nested XML tags like <query>
    tool_code_pattern = r'<tool_code>(.*?)</tool_code>'
    for match in re.finditer(tool_code_pattern, content, re.DOTALL):
        try:
            inner = match.group(1)

            # Extract tool/name field - support both 'tool' and 'name' keys
            tn_match = re.search(r"['\"]?(?:tool|name)['\"]?\s*(?:=>|:)\s*['\"]([^'\"]+)['\"]", inner)
            if not tn_match:
                # Try without quotes: tool => web_search
                tn_match = re.search(r"(?:tool|name)\s*=>\s*(\w+)", inner)

            if tn_match:
                tool_name = tn_match.group(1).strip()

                args = {}

                # First, check for nested XML tags in the entire inner content
                # Look for <query>, <url>, <content>, <input> etc.
                xml_param_pattern = r'<(\w+)>(.*?)</\1>'
                for xml_match in re.finditer(xml_param_pattern, inner, re.DOTALL):
                    tag_name = xml_match.group(1)
                    tag_value = xml_match.group(2).strip()
                    # Map common tag names to argument keys
                    if tag_name in ['query', 'q']:
                        args['query'] = tag_value
                    elif tag_name in ['url', 'link', 'href']:
                        args['url'] = tag_value
                    elif tag_name in ['content', 'text', 'input']:
                        args['content'] = tag_value
                    elif tag_name in ['path', 'file']:
                        args['path'] = tag_value
                    else:
                        args[tag_name] = tag_value

                # If no XML params found, try to extract from args/arguments field
                if not args:
                    # Try to capture everything after args => until the next top-level field or closing brace
                    # This handles multi-line values
                    arg_match = re.search(
                        r"['\"]?(?:args|arguments)['\"]?\s*=>\s*(.+?)(?=,\s*['\"]?\w+['\"]?\s*=>|\}$)",
                        inner, re.DOTALL
                    )
                    if arg_match:
                        val = arg_match.group(1).strip()
                        # Remove surrounding quotes if present
                        if val.startswith(("'", '"')) and val.endswith(("'", '"')):
                            val = val[1:-1]

                        # Check for nested tags inside the value
                        q_match = re.search(r"<query>(.*?)</query>", val, re.DOTALL)
                        if q_match:
                            args["query"] = q_match.group(1).strip()
                        elif tool_name == "web_search":
                            args["query"] = val
                        else:
                            args["content"] = val

                # Try direct 'query' field if still no args
                if not args:
                    q_direct = re.search(r"['\"]?query['\"]?\s*(?:=>|:)\s*['\"]([^'\"]+)['\"]", inner)
                    if q_direct:
                        args["query"] = q_direct.group(1).strip()
                    else:
                        # Try unquoted: query => value
                        q_unquoted = re.search(r"query\s*=>\s*(\w+)", inner)
                        if q_unquoted:
                            args["query"] = q_unquoted.group(1).strip()

                tool_calls.append({
                    "name": tool_name,
                    "arguments": args
                })
                cleaned = cleaned.replace(match.group(0), "")
        except Exception as e:
            # Log error for debugging but don't crash
            import logging
            logging.getLogger("rawclaw.ollama").debug(f"Failed to parse tool_code: {e}")
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

                    content_buffer = ""
                    tool_call_detected = False
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)

                            # Debug: Log what we received
                            if "message" in chunk:
                                msg = chunk["message"]
                                if "tool_calls" in msg and msg["tool_calls"]:
                                    tool_call_detected = True
                                    logger.info(f"[TOOL_TRACE] Model returned native tool_calls: {msg['tool_calls']}")
                                if msg.get("content"):
                                    content_preview = msg['content'][:100].replace('\n', ' ')
                                    logger.debug(f"[TOOL_TRACE] Model content: {content_preview}...")

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
                                            logger.info(f"Yielding tool_call: {tool_name}")
                                            yield {
                                                "type": "tool_call",
                                                "tool_call": {
                                                    "name": tool_name,
                                                    "arguments": arguments,
                                                }
                                            }

                            # Handle content - use a buffer to avoid yielding partial tool-call tags
                            if "message" in chunk and "content" in chunk["message"]:
                                content = chunk["message"]["content"]
                                if content:
                                    content_buffer += content

                                    # Check if we have a complete tool_code block before processing
                                    # tool_code blocks are multi-line, so we need special handling
                                    has_complete_tool_code = '</tool_code>' in content_buffer
                                    has_opening_tool_code = '<tool_code>' in content_buffer

                                    # If we have an opening but no closing, wait for more content
                                    if has_opening_tool_code and not has_complete_tool_code:
                                        # Don't yield anything yet, wait for complete block
                                        continue

                                    # Extract any COMPLETE tags from the current buffer
                                    cleaned_buffer, textual_tool_calls = _extract_textual_tool_calls(content_buffer)

                                    # Yield any complete tool calls found
                                    if textual_tool_calls:
                                        logger.info(f"[TOOL_TRACE] Extracted {len(textual_tool_calls)} textual tool_calls from content")
                                    for tc in textual_tool_calls:
                                        if tc.get("name"):
                                            logger.info(f"[TOOL_TRACE] Yielding textual tool_call: {tc['name']}")
                                            yield {
                                                "type": "tool_call",
                                                "tool_call": {
                                                    "name": tc["name"],
                                                    "arguments": tc.get("arguments", {}),
                                                }
                                            }

                                    # The cleaned_buffer may still contain a trailing partial tag (e.g., "Hello <tool_")
                                    # We wait to yield anything that looks like it's part of an opening tag.
                                    # But be smart about it: if we see <tool_code> or similar, don't yield it
                                    last_bracket = cleaned_buffer.rfind('<')
                                    if last_bracket != -1:
                                        # Check if what's after the bracket looks like a tag start
                                        after_bracket = cleaned_buffer[last_bracket:]
                                        if after_bracket.startswith(('<tool', '<invoke', '<mini', '</too')):
                                            # This is likely a partial tag, keep it in buffer
                                            to_yield = cleaned_buffer[:last_bracket]
                                            content_buffer = cleaned_buffer[last_bracket:]
                                            if to_yield:
                                                yield to_yield
                                        else:
                                            # Not a recognized tag start, yield everything
                                            if cleaned_buffer:
                                                yield cleaned_buffer
                                            content_buffer = ""
                                    else:
                                        # No potential tag start, yield everything and clear buffer
                                        if cleaned_buffer:
                                            yield cleaned_buffer
                                        content_buffer = ""

                            if chunk.get("done"):
                                # Yield any remaining content in the buffer at the end
                                # But first try to extract any tool calls from remaining buffer
                                if content_buffer:
                                    final_cleaned, final_tool_calls = _extract_textual_tool_calls(content_buffer)
                                    for tc in final_tool_calls:
                                        if tc.get("name"):
                                            yield {
                                                "type": "tool_call",
                                                "tool_call": {
                                                    "name": tc["name"],
                                                    "arguments": tc.get("arguments", {}),
                                                }
                                            }
                                    if final_cleaned:
                                        yield final_cleaned
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

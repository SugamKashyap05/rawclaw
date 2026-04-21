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

    # Pattern 6: <tool_code> structured output
    # This handles formats seen in models like Qwen or Claude-lite.
    # We now attempt standard JSON parsing first, with a fallback to fuzzy regex.
    tool_code_pattern = r'<tool_code>(.*?)</tool_code>'
    for match in re.finditer(tool_code_pattern, content, re.DOTALL):
        try:
            inner = match.group(1).strip()
            
            # 1. ATTEMPT PURE JSON PARSING
            try:
                # Replace Ruby-style => with JSON-style : for models that mix them
                json_friendly = inner.replace("=>", ":")
                data = json.loads(json_friendly)
                
                # Support both {tool: "name", args: {...}} and {name: "name", arguments: {...}}
                tool_name = data.get("tool") or data.get("name")
                args = data.get("args") or data.get("arguments") or {}
                
                if tool_name and isinstance(tool_name, str):
                    final_args = {}
                    if isinstance(args, dict):
                        final_args = args
                    elif isinstance(args, str):
                        # Try to find XML tags inside the string argument
                        xml_inner_pattern = r'<(\w+)>(.*?)</\1>'
                        xml_matches = re.findall(xml_inner_pattern, args, re.DOTALL)
                        if xml_matches:
                            for tag_name, tag_value in xml_matches:
                                final_args[tag_name] = tag_value.strip()
                        else:
                            final_args["input"] = args
                    else:
                        final_args["input"] = str(args)

                    tool_calls.append({
                        "name": tool_name.strip(),
                        "arguments": final_args
                    })
                    cleaned = cleaned.replace(match.group(0), "")
                    continue # Successfully parsed as JSON
            except json.JSONDecodeError:
                pass

            # 2. FALLBACK TO FUZZY REGEX (for partial JSON or hash syntax)
            # Extract tool/name field
            tn_match = re.search(r"['\"]?(?:tool|name)['\"]?\s*(?:=>|:)\s*['\"]([^'\"]+)['\"]", inner)
            if not tn_match:
                tn_match = re.search(r"(?:tool|name)\s*(?:=>|:)\s*(\w+)", inner)

            if tn_match:
                tool_name = tn_match.group(1).strip()
                args = {}

                # Look for nested tags like <query>, <url>
                xml_param_pattern = r'<(\w+)>(.*?)</\1>'
                for xml_match in re.finditer(xml_param_pattern, inner, re.DOTALL):
                    tag_name = xml_match.group(1)
                    tag_value = xml_match.group(2).strip()
                    args[tag_name] = tag_value

                # If no XML params, try to extract from args/arguments field
                if not args:
                    arg_match = re.search(
                        r"['\"]?(?:args|arguments)['\"]?\s*(?:=>|:)\s*(.+?)(?=,\s*['\"]?\w+['\"]?\s*(?:=>|:)|\}$)",
                        inner, re.DOTALL
                    )
                    if arg_match:
                        val = arg_match.group(1).strip()
                        if val.startswith(("'", '"')) and val.endswith(("'", '"')):
                            val = val[1:-1]
                        
                        # Try parsing val as JSON if it looks like an object
                        if val.startswith("{") and val.endswith("}"):
                            try:
                                args.update(json.loads(val.replace("=>", ":")))
                            except: pass
                        else:
                            # Map to a default 'input' or 'query' based on tool
                            args["input"] = val

                if not args:
                    # Final attempt: search for any key: value pairs
                    pairs = re.findall(r"['\"]?(\w+)['\"]?\s*(?:=>|:)\s*['\"]?([^'\",\s\}]+)['\"]?", inner)
                    for k, v in pairs:
                        if k not in ('tool', 'name', 'args', 'arguments'):
                            args[k] = v

                tool_calls.append({
                    "name": tool_name,
                    "arguments": args
                })
                cleaned = cleaned.replace(match.group(0), "")
        except Exception as e:
            logger.debug(f"Failed to parse tool_code: {e}")
            pass

    return cleaned, tool_calls


class _TextualToolParser:
    """
    Stateful parser for streaming textual tool calls.
    Buffers potential tags and extracts tool calls once complete blocks are found.
    """

    def __init__(self):
        self._buffer = ""
        # Tags we actively look for start markers
        self._start_tags = ["<tool_code>", "<minimax:tool_call>", "<invoke", "<tool>", "<tool_call>"]
        # Maps start markers to expected end tags
        self._tag_pairs = {
            "<tool_code>": "</tool_code>",
            "<minimax:tool_call>": "</minimax:tool_call>",
            "<invoke": "</invoke>",
            "<tool>": "</tool>",
            "<tool_call>": "</tool_call>"
        }
        self._active_start_tag = None

    def ingest(self, chunk: str) -> AsyncIterator[Dict[str, Any]]:
        """
        Processes a chunk of text and yields either 'content' or 'tool_call' events.
        """
        self._buffer += chunk
        
        while self._buffer:
            if not self._active_start_tag:
                # Find the first occurrence of any start tag
                first_pos = -1
                found_tag = None
                
                for tag in self._start_tags:
                    pos = self._buffer.find(tag)
                    if pos != -1 and (first_pos == -1 or pos < first_pos):
                        first_pos = pos
                        found_tag = tag
                
                if found_tag is not None:
                    # Yield content before the tag
                    if first_pos > 0:
                        yield {"type": "content", "content": self._buffer[:first_pos]}
                        self._buffer = self._buffer[first_pos:]
                    
                    # Check if we have the FULL start tag (some tags like <invoke are partial)
                    # For simple tags like <tool_code>, we just set it as active
                    if found_tag.endswith(">") or " " in found_tag:
                         self._active_start_tag = found_tag
                    else:
                        # Wait for more data if it's a partial match that might be a longer tag
                        # But for our tags, they are either complete or have a space
                        self._active_start_tag = found_tag
                else:
                    # No start tags found. 
                    # BUT wait if the buffer ends with something that looks like a tag start!
                    last_bracket = self._buffer.rfind("<")
                    if last_bracket != -1:
                        potential = self._buffer[last_bracket:]
                        # If potential could become one of our tags, keep it in buffer
                        if any(tag.startswith(potential) for tag in self._start_tags):
                            if last_bracket > 0:
                                yield {"type": "content", "content": self._buffer[:last_bracket]}
                                self._buffer = self._buffer[last_bracket:]
                            return # Wait for more chunks
                    
                    # Safe to yield everything
                    yield {"type": "content", "content": self._buffer}
                    self._buffer = ""
                    return
            else:
                # We are inside an active tag. Look for the end tag.
                end_tag = self._tag_pairs[self._active_start_tag]
                end_pos = self._buffer.find(end_tag)
                
                if end_pos != -1:
                    full_block_end = end_pos + len(end_tag)
                    block_content = self._buffer[:full_block_end]
                    
                    # Extract tool call
                    _, tool_calls = _extract_textual_tool_calls(block_content)
                    for tc in tool_calls:
                        yield {"type": "tool_call", "tool_call": tc}
                    
                    # Clear this block from buffer
                    self._buffer = self._buffer[full_block_end:]
                    self._active_start_tag = None
                else:
                    # Still waiting for end tag
                    return

    def flush(self) -> AsyncIterator[Dict[str, Any]]:
        """Yields any remaining content in the buffer at the end of the stream."""
        if self._buffer:
            _, tool_calls = _extract_textual_tool_calls(self._buffer)
            for tc in tool_calls:
                yield {"type": "tool_call", "tool_call": tc}
            
            # If no tools found or after tools, just yield the raw buffer as content
            # (In case it was an aborted tag or just normal text with a '<')
            cleaned, _ = _extract_textual_tool_calls(self._buffer)
            if cleaned:
                yield {"type": "content", "content": cleaned}
        self._buffer = ""


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

                    parser = _TextualToolParser()
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
                        provider="ollama"
                    ))
                return models
        except Exception:
            return []

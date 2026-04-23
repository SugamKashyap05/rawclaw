import json
import logging
import re
from typing import AsyncIterator, List, Dict, Any, Optional

logger = logging.getLogger("rawclaw.tool_parser")

def extract_textual_tool_calls(content: str) -> tuple[str, List[Dict[str, Any]]]:
    """
    Extract textual tool-call markup from model output.
    Supports multiple formats: <minimax:tool_call>, <invoke>, <tool_code>, etc.
    
    Returns: (cleaned_content, list of tool_call dicts)
    """
    if not content or not isinstance(content, str):
        return content, []

    tool_calls = []
    cleaned = content

    # 1. Minimax / XML-style: <minimax:tool_call>{"name": "...", "arguments": {...}}</minimax:tool_call>
    minimax_pattern = r'<minimax:tool_call>(.*?)</minimax:tool_call>'
    for match in re.finditer(minimax_pattern, content, re.DOTALL):
        try:
            data = json.loads(match.group(1))
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
            cleaned = cleaned.replace(match.group(0), "")
        except (json.JSONDecodeError, AttributeError):
            pass

    # 2. Traditional XML: <invoke name="..."><parameter name="...">...</parameter></invoke>
    invoke_pattern = r'<invoke\s+name="([^"]+)"[^>]*>(.*?)</invoke>'
    for match in re.finditer(invoke_pattern, content, re.DOTALL):
        try:
            tool_name = match.group(1)
            inner = match.group(2)
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

    # 3. Generic <tool_call> or <tool_code>
    generic_patterns = [r'<tool_call>(.*?)</tool_call>', r'<tool_code>(.*?)</tool_code>']
    for pattern in generic_patterns:
        for match in re.finditer(pattern, content, re.DOTALL):
            try:
                inner = match.group(1).strip()
                # Fuzzy extraction of name and parameters
                # Case A: Ruby/Loose-JSON hash { tool => '...', args => { ... } }
                tn_match = re.search(r"['\"]?(?:tool|name)['\"]?\s*(?:=>|:)\s*['\"]([^'\"]+)['\"]", inner)
                if tn_match:
                    tool_name = tn_match.group(1).strip()
                    args = {}
                    args_match = re.search(r"['\"]?(?:args|arguments)['\"]?\s*(?:=>|:)\s*({(?:[^{}]|{[^{}]*})*})", inner, re.DOTALL)
                    if args_match:
                        args_str = args_match.group(1)
                        try:
                            # Sanitize unquoted/ruby-style symbols
                            sanitized = args_str.replace("=>", ":").replace("'", '"')
                            sanitized = re.sub(r'([{,]\s*)([a-zA-Z_]\w*)(\s*:)', r'\1"\2"\3', sanitized)
                            args = json.loads(sanitized)
                        except:
                            args = {"input": args_str}
                    else:
                        # Fallback to tags
                        for xml_match in re.finditer(r'<(\w+)>(.*?)</\1>', inner, re.DOTALL):
                            args[xml_match.group(1)] = xml_match.group(2).strip()
                    
                    tool_calls.append({"name": tool_name, "arguments": args})
                    cleaned = cleaned.replace(match.group(0), "")
                    continue

                # Case B: Direct JSON array or object
                try:
                    data = json.loads(inner.replace("=>", ":"))
                    if isinstance(data, list):
                        for item in data:
                            if "name" in item: tool_calls.append({"name": item["name"], "arguments": item.get("arguments", {})})
                    elif isinstance(data, dict):
                        tool_name = data.get("tool") or data.get("name")
                        args = data.get("args") or data.get("arguments") or {}
                        if tool_name:
                            tool_calls.append({"name": tool_name, "arguments": args})
                    cleaned = cleaned.replace(match.group(0), "")
                except: pass
            except Exception: pass

    return cleaned, tool_calls

class TextualToolParser:
    """Stateful parser for streaming textual tool calls."""
    def __init__(self):
        self._buffer = ""
        self._start_tags = ["<thinking>", "<think>", "<tool_code>", "<minimax:tool_call>", "<invoke", "<tool>", "<tool_call>"]
        self._tag_pairs = {
            "<thinking>": "</thinking>",
            "<think>": "</think>",
            "<tool_code>": "</tool_code>",
            "<minimax:tool_call>": "</minimax:tool_call>",
            "<invoke": "</invoke>",
            "<tool>": "</tool>",
            "<tool_call>": "</tool_call>"
        }
        self._active_start_tag = None

    async def ingest(self, chunk: str) -> AsyncIterator[Dict[str, Any]]:
        self._buffer += chunk
        while self._buffer:
            if not self._active_start_tag:
                first_pos = -1
                found_tag = None
                for tag in self._start_tags:
                    pos = self._buffer.find(tag)
                    if pos != -1 and (first_pos == -1 or pos < first_pos):
                        first_pos = pos
                        found_tag = tag
                
                if found_tag is not None:
                    if first_pos > 0:
                        yield {"type": "content", "content": self._buffer[:first_pos]}
                        self._buffer = self._buffer[first_pos:]
                    
                    # Consume the start tag
                    tag_len = len(found_tag)
                    # Special case for <invoke since it might have attributes
                    if found_tag == "<invoke":
                        tag_end = self._buffer.find(">")
                        if tag_end != -1:
                            tag_len = tag_end + 1
                    
                    self._active_start_tag = found_tag
                    self._buffer = self._buffer[tag_len:]
                else:
                    # No start tag found, but check if we might be partially through one
                    last_bracket = self._buffer.rfind("<")
                    if last_bracket != -1 and any(tag.startswith(self._buffer[last_bracket:]) for tag in self._start_tags):
                        if last_bracket > 0:
                            yield {"type": "content", "content": self._buffer[:last_bracket]}
                            self._buffer = self._buffer[last_bracket:]
                        return 
                    
                    yield {"type": "content", "content": self._buffer}
                    self._buffer = ""
                    return
            else:
                # We are inside a tag
                end_tag = self._tag_pairs[self._active_start_tag]
                
                if self._active_start_tag in ["<thinking>", "<think>"]:
                    # STREAMING THINKING
                    end_pos = self._buffer.find(end_tag)
                    if end_pos != -1:
                        # Found the end tag
                        thought = self._buffer[:end_pos]
                        if thought:
                            yield {"type": "thinking_delta", "thinking": thought}
                        
                        self._buffer = self._buffer[end_pos + len(end_tag):]
                        self._active_start_tag = None
                    else:
                        # Still thinking, yield everything except potential partial end tag
                        potential_end_start = self._buffer.rfind("</")
                        if potential_end_start != -1 and end_tag.startswith(self._buffer[potential_end_start:]):
                            to_yield = self._buffer[:potential_end_start]
                            self._buffer = self._buffer[potential_end_start:]
                        else:
                            to_yield = self._buffer
                            self._buffer = ""
                            
                        if to_yield:
                            yield {"type": "thinking_delta", "thinking": to_yield}
                        return # Need more data
                else:
                    # TOOL CALL MODE (Wait for full block)
                    end_pos = self._buffer.find(end_tag)
                    if end_pos != -1:
                        full_end = end_pos + len(end_tag)
                        # Reconstruct block with original start tag for parser
                        # (since extract_textual_tool_calls expects full tags)
                        # Actually, we can just pass the inner content if we adjust extraction
                        # but for safety let's use the full block.
                        
                        # Reconstruct the block for extraction
                        block = f"{self._active_start_tag}{self._buffer[:full_end]}"
                        _, tool_calls = extract_textual_tool_calls(block)
                        for tc in tool_calls:
                            yield {"type": "tool_call", "tool_call": tc}
                            
                        self._buffer = self._buffer[full_end:]
                        self._active_start_tag = None
                    else:
                        return # Need more data

    async def flush(self) -> AsyncIterator[Dict[str, Any]]:
        if self._buffer:
            _, tool_calls = extract_textual_tool_calls(self._buffer)
            for tc in tool_calls:
                yield {"type": "tool_call", "tool_call": tc}
            cleaned, _ = extract_textual_tool_calls(self._buffer)
            if cleaned: yield {"type": "content", "content": cleaned}
        self._buffer = ""

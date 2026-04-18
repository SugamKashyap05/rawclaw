import anthropic
import json
from typing import AsyncIterator, List, Dict, Any, Union
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.config import settings

class AnthropicProvider(ModelProvider):
    def __init__(self):
        self.api_key = settings.ANTHROPIC_API_KEY
        self.client = None
        if self.api_key:
            self.client = anthropic.AsyncAnthropic(api_key=self.api_key)

    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[Any]:
        if not self.client:
            yield {
                "type": "error",
                "error": "provider_routing_failed",
                "message": "Anthropic API key not configured or invalid."
            }
            return

        model = options.get("model", "claude-3-haiku-20240307") if options else "claude-3-haiku-20240307"
        tools = options.get("tools") if options else None
        
        # Extract system message and format others
        system_msg = ""
        filtered_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg.get("content", "")
            else:
                filtered_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })

        try:
            # State for accumulating streaming tool_use blocks
            _current_tool_name: str | None = None
            _current_tool_id: str | None = None
            _current_tool_input_json: str = ""
            _streamed_tool_ids: set[str] = set()

            # Use the more general message stream to capture both text and tool blocks
            async with self.client.messages.stream(
                model=model,
                max_tokens=4096,
                system=system_msg,
                messages=filtered_messages,
                tools=tools if tools else anthropic.NOT_GIVEN,
                temperature=options.get("temperature", anthropic.NOT_GIVEN),
                top_p=options.get("top_p", anthropic.NOT_GIVEN)
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield event.delta.text

                    elif event.type == "content_block_start" and event.content_block.type == "tool_use":
                        # Begin accumulating a new tool call
                        _current_tool_name = event.content_block.name
                        _current_tool_id = event.content_block.id
                        _current_tool_input_json = ""

                    elif event.type == "content_block_delta" and event.delta.type == "input_json_delta":
                        # Accumulate the JSON input fragments for the tool call
                        _current_tool_input_json += event.delta.partial_json

                    elif event.type == "content_block_stop" and _current_tool_id is not None:
                        # Tool use block complete — parse accumulated input and yield
                        try:
                            tool_input = json.loads(_current_tool_input_json) if _current_tool_input_json else {}
                        except json.JSONDecodeError:
                            tool_input = {}

                        yield {
                            "type": "tool_call",
                            "tool_call": {
                                "name": _current_tool_name,
                                "arguments": tool_input,
                            }
                        }

                        _streamed_tool_ids.add(_current_tool_id)
                        # Reset for the next potential tool_use block
                        _current_tool_name = None
                        _current_tool_id = None
                        _current_tool_input_json = ""
                    
                # After the stream, yield any tool_use blocks not already
                # emitted during streaming (dedup guard prevents double-firing)
                final_msg = await stream.get_final_message()
                for content in final_msg.content:
                    if content.type == "tool_use" and content.id not in _streamed_tool_ids:
                        yield {
                            "type": "tool_call",
                            "function": {
                                "name": content.name,
                                "arguments": json.dumps(content.input)
                            }
                        }
        except Exception as e:
            yield {
                "type": "error",
                "error": "agent_error",
                "message": f"Anthropic error: {str(e)}"
            }

    async def health(self) -> ProviderHealth:
        if not settings.is_anthropic_usable():
            return ProviderHealth(status="unconfigured")
        # Simple check for connectivity if we have a client
        if not self.client:
            return ProviderHealth(status="unconfigured")
            
        try:
            # We'll just check if key exists for now.
            return ProviderHealth(status="ok")
        except Exception as e:
            return ProviderHealth(status="error", error=str(e))

    async def list_models(self) -> List[ModelInfo]:
        # Hardcoded set for standard Claude models since provider API listing varies
        return [
            ModelInfo(id="anthropic/claude-3-haiku-20240307", name="Claude 3 Haiku", provider="anthropic", context_window=200000),
            ModelInfo(id="anthropic/claude-3-sonnet-20240229", name="Claude 3 Sonnet", provider="anthropic", context_window=200000),
            ModelInfo(id="anthropic/claude-3-opus-20240229", name="Claude 3 Opus", provider="anthropic", context_window=200000),
        ]

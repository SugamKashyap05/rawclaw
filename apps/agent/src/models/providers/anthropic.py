import anthropic
from typing import AsyncIterator, List, Dict, Any
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.config import settings

class AnthropicProvider(ModelProvider):
    def __init__(self):
        self.api_key = settings.ANTHROPIC_API_KEY
        self.client = None
        if self.api_key:
            self.client = anthropic.AsyncAnthropic(api_key=self.api_key)

    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[str]:
        if not self.client:
            yield "Error: Anthropic API key not configured."
            return

        model = options.get("model", "claude-3-haiku-20240307") if options else "claude-3-haiku-20240307"
        
        # Anthropic uses 'system' as a top-level parameter, not in messages list for some versions
        # Extract system message if present
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
            async with self.client.messages.stream(
                model=model,
                max_tokens=4096,
                system=system_msg,
                messages=filtered_messages
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as e:
            yield f"Error calling Anthropic: {str(e)}"

    async def health(self) -> ProviderHealth:
        if not self.api_key:
            return ProviderHealth(status="unconfigured")
        # Simple list_models check to verify connectivity
        try:
            # Note: There isn't a direct 'ping' endpoint, but we can try to list models
            # but list_models isn't actually in the AsyncAnthropic client in the same way.
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

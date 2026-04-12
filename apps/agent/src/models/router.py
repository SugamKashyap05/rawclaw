from typing import AsyncIterator, List, Dict, Any, Optional
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.models.providers.ollama import OllamaProvider
from src.models.providers.anthropic import AnthropicProvider
from src.config import settings

class ModelRouter:
    def __init__(self):
        self.providers: Dict[str, ModelProvider] = {
            "ollama": OllamaProvider(),
            "anthropic": AnthropicProvider()
        }
        
        # Complexity to model ID mapping
        self.complexity_map = {
            "low": settings.DEFAULT_LOW_MODEL,
            "medium": settings.DEFAULT_MEDIUM_MODEL,
            "high": settings.DEFAULT_HIGH_MODEL
        }

    def _parse_model_id(self, model_id: str) -> tuple[str, str]:
        """Returns (provider_name, inner_model_name)"""
        if "/" in model_id:
            return model_id.split("/", 1)
        return "ollama", model_id # Default to ollama if no prefix

    async def list_models(self) -> List[ModelInfo]:
        all_models = []
        for provider in self.providers.values():
            models = await provider.list_models()
            all_models.extend(models)
        return all_models

    async def get_health(self) -> Dict[str, ProviderHealth]:
        healths = {}
        for name, provider in self.providers.items():
            healths[name] = await provider.health()
        return healths

    async def complete(
        self, 
        messages: List[Dict[str, Any]], 
        model: Optional[str] = None, 
        complexity: Optional[str] = None
    ) -> AsyncIterator[str]:
        """
        Routes the completion request based on explicit model or complexity hint.
        Implements fallback logic.
        """
        # 1. Determine target model ID
        target_model_id = model
        if not target_model_id and complexity:
            target_model_id = self.complexity_map.get(complexity, settings.DEFAULT_LOW_MODEL)
        
        if not target_model_id:
            target_model_id = settings.DEFAULT_LOW_MODEL

        # 2. Determine provider chain (Primary -> Fallbacks)
        # For now, simple fallback: if target fails, try DEFAULT_LOW_MODEL (Ollama)
        chain = [target_model_id]
        if target_model_id != settings.DEFAULT_LOW_MODEL:
            chain.append(settings.DEFAULT_LOW_MODEL)

        last_error = ""
        for current_model_id in chain:
            provider_name, inner_name = self._parse_model_id(current_model_id)
            provider = self.providers.get(provider_name)
            
            if not provider:
                last_error = f"Provider {provider_name} not found"
                continue

            # Check health before trying (optional but good for graceful degradation)
            health = await provider.health()
            if health.status not in ["ok", "unconfigured"]:
                last_error = f"Provider {provider_name} is {health.status}: {health.error}"
                continue

            try:
                # Attempt completion
                success = False
                async for chunk in provider.complete(messages, {"model": inner_name}):
                    if chunk.startswith("Error:"):
                        last_error = chunk
                        break
                    success = True
                    yield chunk
                
                if success:
                    return # Exit after successful completion
            except Exception as e:
                last_error = str(e)
                continue

        yield f"Routing Error: All providers failed. Last error: {last_error}"

import logging
import time
from typing import AsyncIterator, List, Dict, Any, Optional
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.models.providers.ollama import OllamaProvider
from src.models.providers.anthropic import AnthropicProvider
from src.config import settings

logger = logging.getLogger("rawclaw.router")

class ModelRouter:
    def __init__(self):
        self.providers: Dict[str, ModelProvider] = {
            "ollama": OllamaProvider(),
            "anthropic": AnthropicProvider()
        }
        
        # Check if we have external keys
        has_anthropic = bool(settings.ANTHROPIC_API_KEY)
        
        # Complexity to model ID mapping
        # If no external keys, we route EVERYTHING to ollama to avoid frustrating errors
        self.complexity_map = {
            "low": settings.DEFAULT_LOW_MODEL,
            "medium": settings.DEFAULT_MEDIUM_MODEL if has_anthropic else settings.DEFAULT_LOW_MODEL,
            "high": settings.DEFAULT_HIGH_MODEL if has_anthropic else settings.DEFAULT_LOW_MODEL
        }
        
        # Log effective routing for easier debugging
        logger.info(f"ModelRouter initialized. Routing map: {self.complexity_map}")
        
        self._cached_ollama_tags: Optional[List[str]] = None

    async def _get_ollama_tags(self) -> List[str]:
        """Fetch and cache available Ollama tags."""
        if self._cached_ollama_tags is not None:
            return self._cached_ollama_tags
        
        try:
            models = await self.providers["ollama"].list_models()
            self._cached_ollama_tags = [m.name for m in models]
            return self._cached_ollama_tags
        except Exception:
            return []

    async def _normalize_model_id(self, model_id: str) -> str:
        """
        Normalizes a model ID. For Ollama, resolves base names (e.g. 'llama3') 
        to the best available installed tag (e.g. 'llama3:8b').
        """
        provider_name, inner_name = self._parse_model_id(model_id)
        
        if provider_name != "ollama":
            return model_id
            
        tags = await self._get_ollama_tags()
        if not tags:
            return model_id
            
        # 1. Exact match
        if inner_name in tags:
            return f"ollama/{inner_name}"
            
        # 2. Base name match (e.g. 'llama3' matching 'llama3:8b')
        for tag in tags:
            # Check if inner_name is the portion before the colon
            if ":" in tag and tag.split(":")[0] == inner_name:
                logger.info(f"Normalizing '{inner_name}' to installed tag '{tag}'")
                return f"ollama/{tag}"
                
        # 3. Fallback to original
        return model_id

    def _parse_model_id(self, model_id: str) -> tuple[str, str]:
        """Returns (provider_name, inner_model_name)"""
        if "/" in model_id:
            return model_id.split("/", 1)
        return "ollama", model_id # Default to ollama if no prefix

    async def list_models(self) -> List[ModelInfo]:
        all_models = []
        for provider_name, provider in self.providers.items():
            try:
                models = await provider.list_models()
                all_models.extend(models)
            except Exception as e:
                logger.error(f"Error listing models for provider {provider_name}: {e}")
                # We continue to the next provider instead of failing the whole request
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
        complexity: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None
    ) -> AsyncIterator[Any]:
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
        # Normalize ALL models in the chain, not just the target
        all_ids = [target_model_id] + settings.OLLAMA_FALLBACK_ORDER
        if settings.DEFAULT_LOW_MODEL not in all_ids:
            all_ids.append(settings.DEFAULT_LOW_MODEL)

        # Normalize each model ID (resolves bare names like 'llama3' to 'llama3:8b')
        normalized_ids = []
        for mid in all_ids:
            normalized = await self._normalize_model_id(mid)
            normalized_ids.append(normalized)

        # Build deduplicated chain while preserving order
        chain = []
        seen = set()
        for m_id in normalized_ids:
            if m_id not in seen:
                chain.append(m_id)
                seen.add(m_id)

        last_error = ""
        tried_models = []
        success_model_id = None

        async def run_chain(model_list: List[str]) -> AsyncIterator[Any]:
            nonlocal last_error, success_model_id
            for current_model_id in model_list:
                if current_model_id in tried_models:
                    continue
                tried_models.append(current_model_id)
                
                provider_name, inner_name = self._parse_model_id(current_model_id)
                provider = self.providers.get(provider_name)
                
                if not provider:
                    last_error = f"Provider {provider_name} not found"
                    continue

                try:
                    success = False
                    async for chunk in provider.complete(messages, {
                        "model": inner_name, 
                        "tools": tools,
                        "temperature": temperature,
                        "top_p": top_p
                    }):
                        if isinstance(chunk, dict) and chunk.get("type") == "error":
                            err_msg = chunk.get("message", "")
                            if "not found" in err_msg.lower() or "404" in err_msg:
                                last_error = err_msg
                                break 
                            yield chunk
                        else:
                            success = True
                            yield chunk
                    
                    if success:
                        success_model_id = current_model_id
                        return # Success!
                except Exception as e:
                    last_error = str(e)
                    logger.warning(f"Model {current_model_id} failed: {e}")
                    continue
            
            yield None # Mark failure of this list

        # Record start time
        start_time = time.time()
        
        # Try the initial chain
        async for result in run_chain(chain):
            if result is None:
                break
            yield result
        
        # Success check
        if success_model_id:
            duration_ms = int((time.time() - start_time) * 1000)
            provider_name, _ = self._parse_model_id(success_model_id)
            # Yield metadata
            yield {
                "type": "metadata",
                "metadata": {
                    "modelId": success_model_id,
                    "isLocal": provider_name == "ollama",
                    "fallbacks": [m for m in tried_models if m != success_model_id],
                    "durationMs": duration_ms
                }
            }
            return

        # 3. Dynamic Fallback: If initial chain fails, try any other discovered local Ollama models
        logger.info("Initial fallback chain failed. Attempting dynamic discovery...")
        try:
            available_models = await self.list_models()
            other_models = [
                m.id for m in available_models 
                if m.provider == "ollama" and m.id not in tried_models
            ]
            
            if other_models:
                async for result in run_chain([other_models[0]]):
                    if result is None:
                        break
                    yield result
                
                if success_model_id:
                    duration_ms = int((time.time() - start_time) * 1000)
                    provider_name, _ = self._parse_model_id(success_model_id)
                    yield {
                        "type": "metadata",
                        "metadata": {
                            "modelId": success_model_id,
                            "isLocal": provider_name == "ollama",
                            "fallbacks": [m for m in tried_models if m != success_model_id],
                            "durationMs": duration_ms
                        }
                    }
                    return
        except Exception as e:
            logger.error(f"Dynamic discovery failed: {e}")

        # 4. Final failure frame
        yield {
            "type": "error",
            "error": "provider_routing_failed",
            "message": f"All providers failed. Last error: {last_error}"
        }

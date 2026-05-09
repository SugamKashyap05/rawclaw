import logging
import time
import asyncio
from typing import AsyncIterator, List, Dict, Any, Optional
from src.models.base import ModelProvider, ModelInfo, ProviderHealth
from src.models.capability_manifest import CAPABILITY_MANIFEST, get_capability, is_eligible
from src.models.providers.ollama import OllamaProvider
from src.models.providers.anthropic import AnthropicProvider
from src.models.providers.minimax import MinimaxProvider
from src.config import settings

logger = logging.getLogger("rawclaw.router")
DEFAULT_FALLBACK_MODEL = settings.DEFAULT_HIGH_MODEL or settings.DEFAULT_LOW_MODEL

class ModelRouter:
    def __init__(self):
        self.providers: Dict[str, ModelProvider] = {
            "ollama": OllamaProvider(),
            "anthropic": AnthropicProvider(),
            "minimax": MinimaxProvider()
        }

        
        # Complexity to model ID mapping
        self.complexity_map = {
            "low": settings.DEFAULT_LOW_MODEL,
            "medium": settings.DEFAULT_MEDIUM_MODEL,
            "high": settings.DEFAULT_HIGH_MODEL
        }
        
        # Log effective routing for easier debugging
        logger.info(f"ModelRouter initialized. Routing map: {self.complexity_map}")
        
        self._cached_ollama_tags: Optional[List[str]] = None

    def _provider_is_usable(self, provider_name: str) -> bool:
        if provider_name == "anthropic":
            return bool(getattr(settings, "ANTHROPIC_API_KEY", None))
        if provider_name == "minimax":
            return bool(getattr(settings, "MINIMAX_API_KEY", None))
        return provider_name == "ollama"

    def _task_complexity_for_request(self, complexity: Optional[str], requires_tools: bool) -> str:
        if complexity:
            return complexity
        return "medium" if requires_tools else "low"

    def select_eligible_model(self, requires_tools: bool, complexity: str) -> str:
        complexity_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        preferred_ids: list[str] = []
        if complexity == "critical":
            preferred_ids.extend([
                "anthropic/claude-sonnet-4-20250514",
                "anthropic/claude-haiku-4-5-20251001",
            ])
        preferred_ids.extend([
            self.complexity_map.get(complexity),
            settings.DEFAULT_HIGH_MODEL,
            settings.DEFAULT_MEDIUM_MODEL,
            settings.DEFAULT_LOW_MODEL,
            *settings.OLLAMA_FALLBACK_ORDER,
        ])

        eligible = [
            capability
            for capability in CAPABILITY_MANIFEST.values()
            if self._provider_is_usable(capability.provider)
            and is_eligible(capability.model_id, requires_tools=requires_tools, complexity=complexity)
        ]
        if not eligible:
            raise RuntimeError(
                f"No eligible model exists for complexity={complexity} requires_tools={requires_tools}"
            )

        normalized_preferred: list[str] = []
        seen_preferred: set[str] = set()
        for raw_id in preferred_ids:
            if not raw_id:
                continue
            canonical = raw_id if "/" in raw_id else f"ollama/{raw_id}"
            if canonical in seen_preferred:
                continue
            normalized_preferred.append(canonical)
            seen_preferred.add(canonical)

        eligible_ids = {capability.model_id for capability in eligible}
        for candidate in normalized_preferred:
            if candidate in eligible_ids:
                return candidate

        def sort_key(capability):
            rank = complexity_rank.get(capability.complexity_ceiling, 0)
            if complexity == "critical":
                provider_bias = 0 if capability.provider != "ollama" else 1
            else:
                provider_bias = 0 if capability.provider == "ollama" else 1
            return (provider_bias, -rank, -capability.max_context_tokens)

        return sorted(eligible, key=sort_key)[0].model_id

    def _should_try_next_model(self, error_message: str) -> bool:
        lowered = (error_message or "").lower()
        fallback_markers = [
            "not found",
            "404",
            "does not support tools",
            "does not support chat",
            "does not support generate",
            "not support chat",
            "unsupported chat",
            "unsupported generate",
        ]
        return any(marker in lowered for marker in fallback_markers)

    def _is_tool_support_error(self, error_message: str) -> bool:
        lowered = (error_message or "").lower()
        return (
            "does not support tools" in lowered
            or "does not support chat" in lowered
            or "not support chat" in lowered
            or "unsupported chat" in lowered
        )

    async def _get_ollama_tags(self) -> List[str]:
        """Fetch and cache available Ollama tags with a strict timeout."""
        if self._cached_ollama_tags is not None:
            return self._cached_ollama_tags
        
        try:
            # Added a stricter timeout for the initial tag check
            models = await asyncio.wait_for(
                self.providers["ollama"].list_models(),
                timeout=3.0
            )
            self._cached_ollama_tags = [m.name for m in models]
            return self._cached_ollama_tags
        except Exception as e:
            logger.warning(f"Failed to fetch Ollama tags: {e}")
            return []

    async def normalize_model_id(self, model_id: Optional[str]) -> str:
        """
        Normalizes a model ID. For Ollama, resolves base names (e.g. 'llama3')
        to the best available installed tag (e.g. 'llama3:8b').
        """
        if not model_id:
            return settings.DEFAULT_LOW_MODEL or "ollama/llama3:8b"

        provider_name, inner_name = self._parse_model_id(model_id)
        
        if provider_name != "ollama":
            return model_id

        # FAST TRACK: If it's already a full tag (ollama/name:version), return immediately.
        # This prevents blocking the start of the request on a network call.
        if ":" in inner_name:
            if not model_id.startswith("ollama/"):
                return f"ollama/{inner_name}"
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

    def has_native_thinking(self, model_id: str) -> bool:
        """Checks if a normalized model ID supports native thinking."""
        provider_name, inner_name = self._parse_model_id(model_id)
        provider = self.providers.get(provider_name)
        if provider:
            return provider.has_native_thinking(inner_name)
        return False

    def _parse_model_id(self, model_id: Optional[str]) -> tuple[str, str]:
        """Returns (provider_name, inner_model_name)"""
        if not model_id:
            return "ollama", settings.DEFAULT_LOW_MODEL or "llama3:8b"

        if "/" in model_id:
            parts = model_id.split("/", 1)
            return parts[0], parts[1]
            
        # Detect cloud labels
        if ":cloud" in model_id:
            # Special case: if it starts with 'minimax', 'gpt', or 'claude' but no provider,
            # try to guess the provider or default to anthropic/openai logic.
            # But per user request, we default to ollama if the cloud providers aren't usable.
            if "claude" in model_id:
                return "anthropic", model_id
            if "minimax" in model_id:
                return "minimax", model_id
            return "unknown", model_id # Will trigger fallback to ollama in run_chain
            
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
        explicit_model_requested = bool(model)
        task_requires_tools = bool(tools)
        task_complexity = self._task_complexity_for_request(complexity, task_requires_tools)

        # 1. Determine target model ID
        target_model_id = model
        if not target_model_id and complexity:
            target_model_id = self.complexity_map.get(complexity, settings.DEFAULT_LOW_MODEL)

        if not target_model_id:
            target_model_id = settings.DEFAULT_LOW_MODEL

        logger.info(f"[TOOL_TRACE] Router.complete called: input_model={model}, input_complexity={complexity}, resolved_model={target_model_id}, tools_count={len(tools) if tools else 0}")

        target_model_id = await self.normalize_model_id(target_model_id)
        selected_capability = get_capability(target_model_id)
        if selected_capability is None:
            logger.warning(
                "model_not_in_manifest model_id=%s action=falling_back_to_default",
                target_model_id,
            )
            if explicit_model_requested:
                target_model_id = self.select_eligible_model(task_requires_tools, task_complexity)
            else:
                fallback_candidate = await self.normalize_model_id(DEFAULT_FALLBACK_MODEL)
                target_model_id = (
                    fallback_candidate
                    if is_eligible(fallback_candidate, requires_tools=task_requires_tools, complexity=task_complexity)
                    else self.select_eligible_model(task_requires_tools, task_complexity)
                )
            selected_capability = get_capability(target_model_id)
        elif not is_eligible(target_model_id, requires_tools=task_requires_tools, complexity=task_complexity):
            logger.warning(
                "model_ineligible_for_task model_id=%s requires_tools=%s complexity=%s model_tool_use=%s model_ceiling=%s action=routing_to_eligible_model",
                target_model_id,
                task_requires_tools,
                task_complexity,
                selected_capability.tool_use,
                selected_capability.complexity_ceiling,
            )
            target_model_id = self.select_eligible_model(task_requires_tools, task_complexity)
            selected_capability = get_capability(target_model_id)

        if selected_capability is None:
            raise RuntimeError(f"Capability manifest did not resolve a model for {target_model_id}")

        logger.info(
            "model_routed final_model=%s provider=%s task_complexity=%s requires_tools=%s",
            target_model_id,
            selected_capability.provider,
            task_complexity,
            task_requires_tools,
        )

        # 2. Determine provider chain (Primary -> Fallbacks)
        if explicit_model_requested:
            all_ids = [target_model_id]
        else:
            all_ids = [target_model_id] + settings.OLLAMA_FALLBACK_ORDER
            if settings.DEFAULT_LOW_MODEL not in all_ids:
                all_ids.append(settings.DEFAULT_LOW_MODEL)
            if DEFAULT_FALLBACK_MODEL not in all_ids:
                all_ids.append(DEFAULT_FALLBACK_MODEL)

        # Normalize each model ID (resolves bare names like 'llama3' to 'llama3:8b')
        normalized_ids = []
        for mid in all_ids:
            normalized = await self.normalize_model_id(mid)
            normalized_ids.append(normalized)

        # Build deduplicated chain while preserving order
        chain = []
        seen = set()
        for m_id in normalized_ids:
            if m_id in seen:
                continue
            if not self._provider_is_usable(self._parse_model_id(m_id)[0]):
                continue
            if not is_eligible(m_id, requires_tools=task_requires_tools, complexity=task_complexity):
                continue
            if m_id not in seen:
                chain.append(m_id)
                seen.add(m_id)

        if not chain:
            chain = [self.select_eligible_model(task_requires_tools, task_complexity)]

        last_error = ""
        tried_models = []
        success_model_id = None
        terminal_error_emitted = False

        async def run_chain(model_list: List[str]) -> AsyncIterator[Any]:
            nonlocal last_error, success_model_id, terminal_error_emitted
            for current_model_id in model_list:
                if current_model_id in tried_models:
                    continue
                tried_models.append(current_model_id)
                
                provider_name, inner_name = self._parse_model_id(current_model_id)
                provider = self.providers.get(provider_name)
                
                # Check provider availability
                if provider:
                    health = await provider.health()
                    if health.status == "unconfigured":
                        logger.warning(f"Provider {provider_name} is unconfigured. Skipping model {current_model_id}")
                        provider = None
                
                if not provider:
                    last_error = f"Provider {provider_name} not found or unconfigured"
                    # If this was a cloud request, we continue to the next fallback (ollama)
                    continue


                try:
                    success = False
                    # Call provider.complete and check if it's an async generator
                    generator = provider.complete(messages, {
                        "model": inner_name,
                        "tools": tools,
                        "temperature": temperature,
                        "top_p": top_p
                    })

                    # Use a helper to ensure we have an async iterator
                    async def ensure_async_iterator(g):
                        if hasattr(g, "__aiter__"):
                            async for item in g:
                                yield item
                        elif hasattr(g, "__iter__"):
                            for item in g:
                                yield item
                        else:
                            # Fallback for cases where it's not an iterator but a single value
                            # that needs to be yielded (though provider.complete should be a generator)
                            yield g

                    async for chunk in ensure_async_iterator(generator):
                        if isinstance(chunk, dict) and chunk.get("type") == "error":
                            err_msg = chunk.get("message", "")
                            if tools and self._is_tool_support_error(err_msg):
                                last_error = err_msg
                                logger.warning(
                                    f"Model {current_model_id} rejected tool calling. "
                                    f"Retrying the same model without tools. Error: {err_msg}"
                                )
                                retry_generator = provider.complete(messages, {
                                    "model": inner_name,
                                    "tools": None,
                                    "temperature": temperature,
                                    "top_p": top_p
                                })
                                retry_success = False
                                async for retry_chunk in ensure_async_iterator(retry_generator):
                                    if isinstance(retry_chunk, dict) and retry_chunk.get("type") == "error":
                                        retry_err = retry_chunk.get("message", "")
                                        if self._should_try_next_model(retry_err):
                                            if explicit_model_requested:
                                                terminal_error_emitted = True
                                                yield retry_chunk
                                                return
                                            last_error = retry_err
                                            logger.warning(
                                                f"Model {current_model_id} remained incompatible after toolless retry. "
                                                f"Falling through to the next candidate. Error: {retry_err}"
                                            )
                                            break
                                        terminal_error_emitted = True
                                        yield retry_chunk
                                        return
                                    else:
                                        retry_success = True
                                        success = True
                                        yield retry_chunk
                                if retry_success:
                                    break
                                break
                            if self._should_try_next_model(err_msg):
                                if explicit_model_requested:
                                    terminal_error_emitted = True
                                    yield chunk
                                    return
                                last_error = err_msg
                                logger.warning(f"Model {current_model_id} is incompatible for this request. Falling through to the next candidate. Error: {err_msg}")
                                break
                            terminal_error_emitted = True
                            yield chunk
                            return
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

        if terminal_error_emitted:
            return

        if explicit_model_requested:
            yield {
                "type": "error",
                "error": "provider_routing_failed",
                "message": f"Selected model failed. Last error: {last_error}"
            }
            return

        # 3. Final failure frame
        yield {
            "type": "error",
            "error": "provider_routing_failed",
            "message": f"All providers failed. Last error: {last_error}"
        }

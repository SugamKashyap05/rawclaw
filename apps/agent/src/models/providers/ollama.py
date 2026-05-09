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
        self._chat_capability_cache: Dict[str, Optional[bool]] = {}

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

    def _render_tool_instructions(self, tools: Optional[List[Dict[str, Any]]]) -> str:
        if not tools:
            return ""

        lines: List[str] = [
            "You can use tools when they are necessary.",
            "To call a tool, output exactly one XML block in this format:",
            '<tool_call>{"name":"tool_name","arguments":{"arg":"value"}}</tool_call>',
            "Do not wrap tool calls in markdown fences.",
            "Available tools:",
        ]
        for tool in tools[:24]:
            function = tool.get("function") if isinstance(tool, dict) else {}
            if not isinstance(function, dict):
                continue
            name = str(function.get("name") or "").strip()
            if not name:
                continue
            description = str(function.get("description") or "").strip()
            parameters = function.get("parameters") if isinstance(function.get("parameters"), dict) else {}
            props = parameters.get("properties") if isinstance(parameters, dict) else {}
            arg_names = ", ".join(
                str(key).strip()
                for key in props.keys()
                if str(key).strip()
            ) if isinstance(props, dict) else ""
            arg_suffix = f" Arguments: {arg_names}." if arg_names else ""
            lines.append(f"- {name}: {description or 'No description provided.'}{arg_suffix}")
        return "\n".join(lines).strip()

    def _build_generate_prompt(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> str:
        transcript: List[str] = []
        tool_instructions = self._render_tool_instructions(tools)
        if tool_instructions:
            transcript.append(tool_instructions)
        for message in messages:
            role = str(message.get("role", "user")).strip().lower()
            content = message.get("content", "")
            if isinstance(content, list):
                text = json.dumps(content, ensure_ascii=False)
            else:
                text = str(content or "")
            text = text.strip()
            if not text:
                continue
            if role == "system":
                label = "System"
            elif role == "assistant":
                label = "Assistant"
            else:
                label = "User"
            transcript.append(f"{label}: {text}")
        transcript.append("Assistant:")
        return "\n\n".join(transcript)

    async def _model_supports_chat(self, client: httpx.AsyncClient, model: str) -> Optional[bool]:
        cached = self._chat_capability_cache.get(model)
        if cached is not None:
            return cached

        normalized_model = (model or "").strip().lower()
        if normalized_model.endswith(":cloud") or normalized_model.endswith("-cloud"):
            self._chat_capability_cache[model] = True
            return True

        for payload in ({"name": model}, {"model": model}):
            try:
                response = await client.post(
                    f"{self.base_url}/api/show",
                    json=payload,
                )
            except Exception:
                continue

            if response.status_code == 404:
                continue
            if response.status_code != 200:
                continue

            try:
                data = response.json()
            except Exception:
                data = {}

            template = str(data.get("template") or "").strip()
            if not template:
                modelfile = str(data.get("modelfile") or "")
                match = re.search(r'TEMPLATE\s+"""(.*?)"""', modelfile, re.DOTALL)
                if match:
                    template = match.group(1).strip()

            capabilities = data.get("capabilities")
            supports_chat = bool(template)
            if not supports_chat and isinstance(capabilities, list):
                lowered_caps = {str(cap).strip().lower() for cap in capabilities if str(cap).strip()}
                if "tools" in lowered_caps or "vision" in lowered_caps or normalized_model.endswith(":cloud") or normalized_model.endswith("-cloud"):
                    supports_chat = True
            self._chat_capability_cache[model] = supports_chat
            return supports_chat

        return None

    async def _stream_generate_fallback(
        self,
        client: httpx.AsyncClient,
        *,
        model: str,
        messages: List[Dict[str, Any]],
        options: Dict[str, Any],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[Any]:
        prompt = self._build_generate_prompt(messages, tools=tools)
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": True,
            "options": options or {},
        }

        logger.warning(f"Ollama model {model} is using /api/generate fallback.")
        parser = TextualToolParser()

        async with client.stream(
            "POST",
            f"{self.base_url}/api/generate",
            json=payload,
        ) as response:
            if response.status_code != 200:
                error_detail_raw = await response.aread()
                error_detail = error_detail_raw.decode()
                error_type = "provider_http_error"
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
                except json.JSONDecodeError:
                    continue

                response_text = chunk.get("response")
                if response_text:
                    async for event in parser.ingest(str(response_text)):
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

    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[Any]:
        # Default to low model suffix if no model specified
        default_model = settings.DEFAULT_LOW_MODEL.split('/')[-1]
        options = options or {}
        model = options.get("model", default_model)
        tools = options.get("tools")

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
                supports_chat = await self._model_supports_chat(client, model)
                if supports_chat is False:
                    logger.info(f"[MODEL_ROUTE] {model} -> generate")
                    async for event in self._stream_generate_fallback(
                        client,
                        model=model,
                        messages=messages,
                        options=payload["options"],
                        tools=tools,
                    ):
                        yield event
                    return

                logger.info(f"[MODEL_ROUTE] {model} -> chat")
                async with client.stream(
                    "POST",
                    f"{self.base_url}/api/chat",
                    json=payload
                ) as response:
                    if response.status_code != 200:
                        error_detail_raw = await response.aread()
                        error_detail = error_detail_raw.decode()
                        lowered_error = error_detail.lower()

                        if "does not support chat" in lowered_error:
                            self._chat_capability_cache[model] = False
                            logger.info(f"[MODEL_ROUTE] {model} -> generate (fallback after chat rejection)")
                            async for event in self._stream_generate_fallback(
                                client,
                                model=model,
                                messages=messages,
                                options=payload["options"],
                                tools=tools,
                            ):
                                yield event
                            return

                        error_type = "provider_http_error"
                        # Heuristic: detect context length/prompt too long errors
                        if "too long" in lowered_error or "context" in lowered_error:
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
                                    # IMPORTANT: parser.ingest is an async generator.
                                    # We must use 'async for' here.
                                    async for event in parser.ingest(content):
                                        if event["type"] == "content":
                                            yield event["content"]
                                        else:
                                            yield event

                            if chunk.get("done"):
                                # IMPORTANT: parser.flush is also an async generator.
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

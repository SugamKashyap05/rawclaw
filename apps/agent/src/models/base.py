from abc import ABC, abstractmethod
from typing import AsyncIterator, List, Optional, Dict, Any
from pydantic import BaseModel

class ModelInfo(BaseModel):
    id: str
    name: str
    provider: str
    description: Optional[str] = None
    context_window: Optional[int] = None
    supports_thinking: bool = False

class ProviderHealth(BaseModel):
    status: str
    latency_ms: Optional[float] = None
    error: Optional[str] = None

class ModelProvider(ABC):
    @abstractmethod
    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[Any]:
        """Provides a streaming completion for the given messages."""
        pass

    def has_native_thinking(self, model_id: str) -> bool:
        """Returns True if the specific model supports native thinking/reasoning blocks."""
        return False

    @abstractmethod
    async def health(self) -> ProviderHealth:
        """Checks the health of the provider."""
        pass

    @abstractmethod
    async def list_models(self) -> List[ModelInfo]:
        """Lists available models for this provider."""
        pass

from abc import ABC, abstractmethod
from typing import AsyncIterator, List, Optional, Dict, Any
from pydantic import BaseModel

class ModelInfo(BaseModel):
    id: str
    name: str
    provider: str
    description: Optional[str] = None
    context_window: Optional[int] = None

class ProviderHealth(BaseModel):
    status: str
    latency_ms: Optional[float] = None
    error: Optional[str] = None

class ModelProvider(ABC):
    @abstractmethod
    async def complete(self, messages: List[Dict[str, Any]], options: Dict[str, Any] = None) -> AsyncIterator[str]:
        """Provides a streaming completion for the given messages."""
        pass

    @abstractmethod
    async def health(self) -> ProviderHealth:
        """Checks the health of the provider."""
        pass

    @abstractmethod
    async def list_models(self) -> List[ModelInfo]:
        """Lists available models for this provider."""
        pass

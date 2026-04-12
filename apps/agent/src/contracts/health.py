from pydantic import BaseModel
from typing import Dict, Literal

class HealthStatus(BaseModel):
    """Represents the universal health check payload structure."""
    status: Literal['ok', 'degraded', 'down']
    services: Dict[str, Literal['ok', 'down']]
    version: str
    timestamp: str

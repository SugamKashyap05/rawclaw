"""Per-collection memory retrieval quality configuration."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Dict

logger = logging.getLogger("rawclaw.memory.collection_config")


@dataclass(frozen=True)
class CollectionRetrievalConfig:
    max_distance: float = 0.25
    similarity_floor: float | None = None
    min_results: int = 1
    max_results: int = 10

    def __post_init__(self) -> None:
        derived_floor = round(1.0 - self.max_distance, 6)
        current_floor = derived_floor if self.similarity_floor is None else self.similarity_floor
        object.__setattr__(self, "similarity_floor", current_floor)
        if abs((1.0 - self.max_distance) - float(current_floor)) > 0.001:
            raise ValueError(
                f"similarity_floor ({current_floor}) must equal "
                f"1.0 - max_distance ({self.max_distance})"
            )
        if self.max_distance < 0 or self.max_distance > 1:
            raise ValueError("max_distance must be between 0 and 1")
        if self.max_results < 1:
            raise ValueError("max_results must be at least 1")


DEFAULT_COLLECTION_CONFIGS: Dict[str, CollectionRetrievalConfig] = {
    "default": CollectionRetrievalConfig(max_distance=0.25),
    "knowledge_brain": CollectionRetrievalConfig(max_distance=0.30),
    "conversation": CollectionRetrievalConfig(max_distance=0.20),
    "sessions": CollectionRetrievalConfig(max_distance=0.20),
    "skills": CollectionRetrievalConfig(max_distance=0.28),
}


def get_collection_config(collection_name: str | None) -> CollectionRetrievalConfig:
    resolved_name = (collection_name or "default").strip() or "default"
    env_override = os.getenv("RAWCLAW_COLLECTION_CONFIG")
    if env_override:
        try:
            overrides = json.loads(env_override)
            if isinstance(overrides, dict) and resolved_name in overrides:
                return CollectionRetrievalConfig(**overrides[resolved_name])
            if isinstance(overrides, dict) and "default" in overrides and resolved_name not in DEFAULT_COLLECTION_CONFIGS:
                return CollectionRetrievalConfig(**overrides["default"])
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            logger.error("invalid_collection_retrieval_config error=%s", error)

    return DEFAULT_COLLECTION_CONFIGS.get(resolved_name, DEFAULT_COLLECTION_CONFIGS["default"])

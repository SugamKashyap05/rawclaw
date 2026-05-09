import pytest

from src.memory.collection_config import CollectionRetrievalConfig, get_collection_config


def test_per_collection_floor_respected():
    config = get_collection_config("conversation")
    assert config.max_distance == 0.20
    assert config.similarity_floor == 0.80


def test_env_override_applies(monkeypatch):
    monkeypatch.setenv(
        "RAWCLAW_COLLECTION_CONFIG",
        '{"default": {"max_distance": 0.15, "similarity_floor": 0.85}}',
    )
    config = get_collection_config("default")
    assert config.max_distance == 0.15
    assert config.similarity_floor == 0.85


def test_malformed_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("RAWCLAW_COLLECTION_CONFIG", "not-valid-json")
    config = get_collection_config("default")
    assert config.max_distance == 0.25


def test_similarity_floor_must_match_max_distance():
    with pytest.raises(ValueError):
        CollectionRetrievalConfig(max_distance=0.25, similarity_floor=0.20)

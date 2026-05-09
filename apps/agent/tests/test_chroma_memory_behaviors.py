from datetime import datetime, timedelta, timezone

from src.memory.chroma_memory import ChromaMemory


class DuplicateAwareCollection:
    def __init__(self):
        self.upserts = []

    def query(self, **kwargs):
        return {
            "ids": [["operator-1"]],
            "documents": [["Operator preference: concise briefings"]],
            "metadatas": [[{
                "collection": "operator",
                "source": "assistant-state",
                "timestamp": "2026-05-08T00:00:00Z",
                "tags": '["assistant","operator-profile","preference"]',
            }]],
            "distances": [[0.01]],
        }

    def get(self, **kwargs):
        return {
            "ids": ["entry-1", "entry-2"],
            "documents": ["Older note", "Newest note"],
            "metadatas": [
                {"collection": "operator", "timestamp": "2026-05-08T00:00:00Z", "tags": '["operator"]'},
                {"collection": "operator", "timestamp": "2026-05-08T02:00:00Z", "tags": '["operator"]'},
            ],
        }

    def upsert(self, **kwargs):
        self.upserts.append(kwargs)


class MaintenanceCollection:
    def __init__(self):
        self.deleted_ids = []

    def count(self):
        return 6105

    def get(self, where=None, include=None):
        if where == {"collection": "tool_discovery"}:
            return {
                "ids": ["tool-1-old", "tool-1-new", "tool-2"],
                "documents": [
                    "Tool Name: search\nServer: alpha",
                    "Tool Name: search\nServer: alpha",
                    "Tool Name: browse\nServer: beta",
                ],
                "metadatas": [
                    {"collection": "tool_discovery", "tool_name": "search", "server_name": "alpha", "timestamp": "2026-05-01T00:00:00Z"},
                    {"collection": "tool_discovery", "tool_name": "search", "server_name": "alpha", "timestamp": "2026-05-08T00:00:00Z"},
                    {"collection": "tool_discovery", "tool_name": "browse", "server_name": "beta", "timestamp": "2026-05-07T00:00:00Z"},
                ],
            }
        if where == {"collection": "sessions"}:
            now = datetime.now(timezone.utc)
            return {
                "ids": ["old-1", "recent-1", "recent-2", "recent-3"],
                "metadatas": [
                    {"collection": "sessions", "session_id": "s-1", "timestamp": (now - timedelta(days=30)).isoformat()},
                    {"collection": "sessions", "session_id": "s-1", "timestamp": (now - timedelta(hours=3)).isoformat()},
                    {"collection": "sessions", "session_id": "s-1", "timestamp": (now - timedelta(hours=2)).isoformat()},
                    {"collection": "sessions", "session_id": "s-1", "timestamp": (now - timedelta(hours=1)).isoformat()},
                ],
            }
        tool_ids = [f"tool-{index}" for index in range(1001)]
        return {
            "ids": ["s1", "s2", *tool_ids, "default-1"],
            "metadatas": [
                {"collection": "sessions"},
                {"collection": "sessions"},
                *( {"collection": "tool_discovery"} for _ in tool_ids ),
                {"collection": "default"},
            ],
        }

    def delete(self, ids):
        self.deleted_ids.extend(ids)


def build_memory(collection) -> ChromaMemory:
    memory = ChromaMemory.__new__(ChromaMemory)
    memory.collection = collection
    memory.collection_name = "rawclaw_memory"
    memory.client = None
    memory.embedding_model = object()
    memory.persist_directory = ""
    memory._embed = lambda text: [0.1, 0.2, 0.3]
    return memory


def test_add_document_reuses_near_duplicate_in_same_collection():
    memory = build_memory(DuplicateAwareCollection())

    entry = memory.add_document(
        content="Operator preference: concise briefings",
        tags=["assistant", "operator-profile", "preference"],
        source="assistant-state",
        collection="operator",
    )

    assert entry["id"] == "operator-1"
    assert memory.collection.upserts[0]["ids"] == ["operator-1"]


def test_blank_search_browses_recent_entries_instead_of_returning_zero_matches():
    memory = build_memory(DuplicateAwareCollection())

    results = memory.search(query="", collection="operator", n_results=2)

    assert [item["id"] for item in results] == ["entry-2", "entry-1"]
    assert all(item["score"] == 1.0 for item in results)


def test_stats_include_collection_counts_and_health_warnings():
    memory = build_memory(MaintenanceCollection())

    stats = memory.get_stats()

    assert stats["collectionCounts"]["tool_discovery"] == 1001
    assert stats["collectionCounts"]["sessions"] == 2
    assert any("Vector memory is large" in warning for warning in stats["warnings"])
    assert any('Collection "tool_discovery" is large' in warning for warning in stats["warnings"])


def test_dedupe_tool_discovery_keeps_latest_entry_per_tool():
    memory = build_memory(MaintenanceCollection())

    result = memory.dedupe_tool_discovery()

    assert result["duplicatesRemoved"] == 1
    assert memory.collection.deleted_ids == ["tool-1-old"]


def test_prune_sessions_applies_ttl_and_per_session_cap():
    memory = build_memory(MaintenanceCollection())

    result = memory.prune_sessions(ttl_days=14, max_entries_per_session=2)

    assert result["deletedEntries"] == 2
    assert set(memory.collection.deleted_ids) == {"old-1", "recent-1"}

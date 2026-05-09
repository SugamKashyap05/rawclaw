from src.contracts.chat import ChatMessage
from src.executor import Executor


class FakeChromaMemory:
    def __init__(self):
        self.calls = []
        self.literal_calls = []

    def add_message(self, session_id, role, content, metadata=None):
        self.calls.append(
            {
                "session_id": session_id,
                "role": role,
                "content": content,
                "metadata": metadata or {},
            }
        )

    def search_literal(self, query, session_id=None, source=None, collection=None, n_results=3):
        self.literal_calls.append(
            {
                "query": query,
                "session_id": session_id,
                "source": source,
                "collection": collection,
                "n_results": n_results,
            }
        )
        return []


def test_store_turn_recall_memory_only_writes_latest_user_turn_and_final_outputs():
    executor = Executor()
    chroma = FakeChromaMemory()
    messages = [
        ChatMessage(role="user", content="older user turn"),
        ChatMessage(role="assistant", content="older assistant turn"),
        ChatMessage(role="user", content="latest user turn"),
    ]

    executor._store_turn_recall_memory(
        chroma,
        "session-1",
        messages,
        assistant_content="final answer",
        tool_summaries=[{"tool_name": "web_search", "summary": "tool=web_search; results=3"}],
    )

    assert [call["role"] for call in chroma.calls] == ["user", "tool", "assistant"]
    assert chroma.calls[0]["content"] == "latest user turn"
    assert chroma.calls[1]["metadata"]["memory_type"] == "tool_summary"
    assert chroma.calls[2]["content"] == "final answer"


def test_conversational_literal_memory_hits_stays_inside_allowed_collections():
    executor = Executor()
    chroma = FakeChromaMemory()

    executor._conversational_literal_memory_hits(chroma, "PROJECT_VANGUARD", "session-2", limit=3)

    assert chroma.literal_calls == [
        {
            "query": "PROJECT_VANGUARD",
            "session_id": None,
            "source": "session:session-2",
            "collection": "session",
            "n_results": 3,
        },
        {
            "query": "PROJECT_VANGUARD",
            "session_id": "session-2",
            "source": None,
            "collection": "sessions",
            "n_results": 3,
        },
        {
            "query": "PROJECT_VANGUARD",
            "session_id": None,
            "source": None,
            "collection": "operator",
            "n_results": 3,
        },
        {
            "query": "PROJECT_VANGUARD",
            "session_id": None,
            "source": None,
            "collection": "mission",
            "n_results": 3,
        },
        {
            "query": "PROJECT_VANGUARD",
            "session_id": None,
            "source": None,
            "collection": "default",
            "n_results": 3,
        },
    ]

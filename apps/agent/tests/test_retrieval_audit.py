from unittest.mock import MagicMock

from src.memory.retrieval_audit import retrieve_with_audit


def make_mock_collection(docs, distances):
    col = MagicMock()
    col.name = "test_collection"
    col.query.return_value = {
        "documents": [docs],
        "distances": [distances],
        "ids": [[f"id-{idx}" for idx, _ in enumerate(docs)]],
        "metadatas": [[{"idx": idx} for idx, _ in enumerate(docs)]],
    }
    return col


def test_returns_documents_with_audit():
    col = make_mock_collection(["doc one", "doc two"], [0.1, 0.2])
    docs, audit, raw = retrieve_with_audit(col, "test query", turn_id="t-001", k=5)
    assert len(docs) == 2
    assert audit.turn_id == "t-001"
    assert audit.results_returned == 2
    assert audit.was_truncated is False
    assert raw["documents"][0] == docs


def test_token_budget_truncates_results():
    long_docs = ["word " * 500] * 5
    distances = [0.1, 0.15, 0.2, 0.25, 0.3]
    col = make_mock_collection(long_docs, distances)

    docs, audit, _ = retrieve_with_audit(col, "query", turn_id="t-002", k=5, token_limit=800)
    assert len(docs) < 5
    assert audit.was_truncated is True
    assert audit.token_budget_used <= 800


def test_empty_result_flagged_in_audit():
    col = make_mock_collection([], [])
    docs, audit, _ = retrieve_with_audit(col, "query", turn_id="t-003", k=5)
    assert docs == []
    assert audit.results_returned == 0
    assert audit.highest_score == 0.0

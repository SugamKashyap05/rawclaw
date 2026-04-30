import json
from pathlib import Path

from src.research.evidence_pipeline import loyalty_check, select_evidence, synthesize_answer


ARTIFACT_PATH = Path(__file__).parent / "artifacts" / "evidence_pipeline_matrix.json"
REAL_SCRAPE_ARTIFACT_PATH = Path(__file__).parent / "artifacts" / "web_scrape_capture.json"
IDEAL_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "evidence_pipeline_ideal.json"


def _load_matrix():
    payload = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    return {item["id"]: item["toolResult"]["output"] for item in payload["targets"]}


def _load_real_scrape_outputs():
    payload = json.loads(REAL_SCRAPE_ARTIFACT_PATH.read_text(encoding="utf-8"))
    return {
        item["id"]: {
            "task": item.get("input", {}).get("taskType") or "page_read",
            "output": item["toolResult"]["output"],
        }
        for item in payload["targets"]
    }


def _load_ideal_fixture():
    payload = json.loads(IDEAL_FIXTURE_PATH.read_text(encoding="utf-8"))
    return {item["id"]: item for item in payload["targets"]}


def _assert_confidence_with_tolerance(actual: float, expected: float):
    assert abs(float(actual) - float(expected)) <= 0.15, f"confidence drifted too far: actual={actual}, expected={expected}"


def _assert_word_count_with_tolerance(actual: int, expected: int):
    if expected == 0:
        assert int(actual) == 0, f"wordCount expected 0 but got {actual}"
        return
    lower = expected * 0.8
    upper = expected * 1.2
    assert lower <= int(actual) <= upper, f"wordCount drifted too far: actual={actual}, expected={expected}"


def test_evidence_transport_failure_is_not_usable():
    verdict = select_evidence({"kind": "transport_failure", "fetchFailureKind": "connect_failure", "tier": "failed", "confidence": 0.05})
    assert verdict.usable is False
    assert verdict.evidenceSource == "none"
    assert "transport_failure" in verdict.reason


def test_evidence_empty_body_is_not_usable():
    verdict = select_evidence({"kind": "content", "wordCount": 0, "tier": "failed", "confidence": 0.05})
    assert verdict.usable is False
    assert "empty_body" in verdict.reason


def test_evidence_structured_data_is_usable():
    verdict = select_evidence({"kind": "content", "structuredRecordCount": 5, "tier": "clean", "confidence": 1.0, "wordCount": 22})
    assert verdict.usable is True
    assert verdict.evidenceSource == "structured_data"


def test_evidence_partial_with_low_wordcount_is_not_usable():
    verdict = select_evidence({"kind": "content", "tier": "partial", "confidence": 0.7, "wordCount": 40})
    assert verdict.usable is False
    assert verdict.evidenceSource == "none"


def test_evidence_js_fallback_adds_warning():
    verdict = select_evidence(
        {
            "kind": "content",
            "tier": "partial",
            "confidence": 0.7,
            "wordCount": 332,
            "structuredRecordCount": 0,
            "jsFallbackDetected": True,
        }
    )
    assert verdict.usable is True
    assert any("js_fallback" in item for item in verdict.warningFlags)


def test_evidence_clean_page_is_usable():
    verdict = select_evidence({"kind": "content", "tier": "clean", "confidence": 1.0, "wordCount": 372})
    assert verdict.usable is True
    assert verdict.evidenceSource == "page_content"


def test_synthesis_refuses_on_transport_failure():
    result = synthesize_answer({"kind": "transport_failure", "fetchFailureKind": "connect_failure", "tier": "failed", "confidence": 0.05}, "page_read")
    assert result.answerSource == "fallback_refused"
    assert "could not be fetched or extracted" in result.answer.lower()
    assert "reserved domains" not in result.answer.lower()


def test_synthesis_uses_structured_data_for_ipl():
    extract_output = _load_matrix()["ipl_points_table"]
    result = synthesize_answer(extract_output, "factual_extract")
    assert result.answerSource == "structured_data"
    assert {"team", "points", "nrr"}.issubset(set(result.groundedFields))
    assert "Chennai Super Kings" in result.answer
    assert "6 points" in result.answer


def test_synthesis_uses_page_content_for_iana():
    extract_output = _load_matrix()["iana_reserved_domains"]
    result = synthesize_answer(extract_output, "page_read")
    assert result.answerSource == "page_content"
    assert "reserved domains" in result.answer.lower()
    assert "RFC 2606" in result.answer


def test_synthesis_does_not_hallucinate_on_empty():
    extract_output = _load_matrix()["openai_changelog"]
    result = synthesize_answer(extract_output, "page_read")
    assert result.answerSource == "fallback_refused"
    assert "requires javascript rendering" in result.answer.lower()
    assert "2024" not in result.answer
    assert "update" not in result.answer.lower() or "could not" in result.answer.lower()


def test_synthesis_includes_js_warning_when_flagged():
    extract_output = _load_matrix()["python_3144_release"]
    result = synthesize_answer(extract_output, "page_read")
    assert "no-javascript fallback" in result.answer.lower()
    assert "PEP 784" in result.answer


def test_loyalty_passes_when_answer_uses_extracted_content():
    extract_output = _load_matrix()["iana_reserved_domains"]
    synthesis = synthesize_answer(extract_output, "page_read")
    result = loyalty_check(synthesis.answer, extract_output)
    assert result.loyal is True
    assert result.score >= 0.8


def test_loyalty_fails_when_answer_invents_facts():
    extract_output = _load_matrix()["ipl_points_table"]
    answer = "The IPL 2026 standings show Mumbai Indians in 1st place with 20 points."
    result = loyalty_check(answer, extract_output)
    assert result.loyal is False
    assert any("Mumbai Indians" in item for item in result.violations)


def test_loyalty_passes_on_refusal_answer():
    extract_output = {"kind": "transport_failure", "fetchFailureKind": "connect_failure", "content": "", "structuredData": {}, "title": ""}
    answer = "This page could not be fetched or extracted. Reason: transport_failure: connect_failure"
    result = loyalty_check(answer, extract_output)
    assert result.loyal is True


def test_loyalty_catches_snippet_leakage():
    extract_output = _load_matrix()["iana_reserved_domains"]
    answer = "The page also says OpenAI released a new Responses API migration guide this week."
    result = loyalty_check(answer, extract_output)
    assert result.loyal is False
    assert any("OpenAI" in item for item in result.violations)


def test_loyalty_catches_version_hallucination():
    extract_output = _load_matrix()["python_3144_release"]
    answer = "Python Release Python 3.14.3 includes PEP 784 and maintenance notes."
    result = loyalty_check(answer, extract_output)
    assert result.loyal is False
    assert any("3.14.3" in item for item in result.violations)


def test_loyalty_tolerates_reasonable_paraphrase():
    extract_output = {
        "title": "Bugfix Summary",
        "content": "The release includes 337 bugfixes across the runtime and standard library.",
        "structuredData": {},
    }
    answer = "The release includes over 300 bug fixes across the runtime and standard library."
    result = loyalty_check(answer, extract_output)
    assert result.loyal is True


def test_loyalty_keeps_version_and_pep_claims_whole():
    extract_output = {
        "title": "Python Release Python 3.14.4 | Python.org",
        "content": "Python Release Python 3.14.4 includes work related to PEP 784, PEP 779, and PEP 750 in the Python 3.14 series.",
        "structuredData": {"event": "Python Release Python 3.14.4"},
    }
    answer = "Python Release Python 3.14.4 includes PEP 784, PEP 779, and PEP 750 in the Python 3.14 series."

    result = loyalty_check(answer, extract_output)

    assert result.loyal is True
    assert not any(item.endswith(": 3") or item.endswith(": 14") or item.endswith(": 4") for item in result.violations)


def test_pipeline_matrix_targets():
    matrix = _load_matrix()
    expectations = {
        "example_domain": {"usable": False, "answerSource": "fallback_refused"},
        "iana_reserved_domains": {"usable": True, "evidenceSource": "page_content", "answerSource": "page_content"},
        "times_of_india_homepage": {"usable": True, "answerSource": "structured_data"},
        "ipl_points_table": {"usable": True, "evidenceSource": "structured_data", "answerSource": "structured_data"},
        "openai_changelog": {"usable": False, "answerSource": "fallback_refused"},
        "python_3144_release": {"usable": True, "answerSource": "page_content", "warning": "js_fallback"},
    }

    for target_id, extract_output in matrix.items():
        verdict = select_evidence(extract_output)
        synthesis = synthesize_answer(extract_output, "page_read")
        loyalty = loyalty_check(synthesis.answer, extract_output)

        expected = expectations[target_id]
        assert verdict.usable is expected["usable"]
        if "evidenceSource" in expected:
            assert verdict.evidenceSource == expected["evidenceSource"]
        assert synthesis.answerSource == expected["answerSource"]

        if not verdict.usable:
            assert synthesis.answerSource == "fallback_refused"
        else:
            assert loyalty.loyal is True

        if target_id == "times_of_india_homepage":
            assert "Chennai Koovagam festival" in synthesis.answer
            assert "Akhilesh" in synthesis.answer
        if target_id == "python_3144_release":
            assert any("js_fallback" in item for item in verdict.warningFlags)
            assert "PEP 784" in synthesis.answer


def test_fixture_answers_are_loyal_to_real_scrape_artifact():
    real_outputs = _load_real_scrape_outputs()
    ideal_fixture = _load_ideal_fixture()

    for target_id, expected in ideal_fixture.items():
        actual_extract = real_outputs[target_id]["output"]
        fixture_answer = expected["synthesis"]["answer"]
        loyalty = loyalty_check(fixture_answer, actual_extract)
        assert loyalty.loyal is expected["loyalty"]["loyal"], (
            f"fixture answer for {target_id} is not loyal to the real scrape artifact: {loyalty.violations}"
        )


def test_real_pipeline_output_matches_ideal_fixture_with_tolerance():
    real_outputs = _load_real_scrape_outputs()
    ideal_fixture = _load_ideal_fixture()

    for target_id, expected in ideal_fixture.items():
        actual_extract = real_outputs[target_id]["output"]
        actual_task = real_outputs[target_id]["task"]
        expected_extract = expected["extract"]
        expected_evidence = expected["evidence"]
        expected_synthesis = expected["synthesis"]

        actual_verdict = select_evidence(actual_extract)
        actual_synthesis = synthesize_answer(actual_extract, actual_task)

        assert actual_extract.get("kind") == expected_extract["kind"], (
            f"{target_id}: kind mismatch actual={actual_extract.get('kind')} expected={expected_extract['kind']}"
        )
        _assert_confidence_with_tolerance(actual_extract.get("confidence", 0.0), expected_extract["confidence"])
        _assert_word_count_with_tolerance(actual_extract.get("wordCount", 0), expected_extract["wordCount"])
        assert actual_extract.get("structuredData") == expected_extract["structuredData"], (
            f"{target_id}: structuredData mismatch actual={actual_extract.get('structuredData')} expected={expected_extract['structuredData']}"
        )

        assert actual_verdict.usable is expected_evidence["usable"], (
            f"{target_id}: evidence usability mismatch actual={actual_verdict.usable} expected={expected_evidence['usable']}"
        )
        assert actual_verdict.evidenceSource == expected_evidence["evidenceSource"], (
            f"{target_id}: evidenceSource mismatch actual={actual_verdict.evidenceSource} expected={expected_evidence['evidenceSource']}"
        )
        assert actual_synthesis.answerSource == expected_synthesis["answerSource"], (
            f"{target_id}: answerSource mismatch actual={actual_synthesis.answerSource} expected={expected_synthesis['answerSource']}"
        )
        assert actual_synthesis.usedFallback is expected_synthesis["usedFallback"], (
            f"{target_id}: usedFallback mismatch actual={actual_synthesis.usedFallback} expected={expected_synthesis['usedFallback']}"
        )

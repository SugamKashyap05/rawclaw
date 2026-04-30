import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.research.evidence_pipeline import loyalty_check, select_evidence, synthesize_answer


CAPTURE_ENABLED = os.getenv("RAWCLAW_RUN_EVIDENCE_PIPELINE_CAPTURE") == "1"
REAL_SCRAPE_ARTIFACT_PATH = Path(__file__).parent / "artifacts" / "web_scrape_capture.json"
IDEAL_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "evidence_pipeline_ideal.json"
OUTPUT_PATH = Path(__file__).parent / "artifacts" / "evidence_pipeline_verification.json"


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


def _within_confidence_tolerance(actual: float, expected: float) -> bool:
    return abs(float(actual) - float(expected)) <= 0.15


def _within_wordcount_tolerance(actual: int, expected: int) -> bool:
    if expected == 0:
        return int(actual) == 0
    lower = expected * 0.8
    upper = expected * 1.2
    return lower <= int(actual) <= upper


@pytest.mark.skipif(
    not CAPTURE_ENABLED,
    reason="Set RAWCLAW_RUN_EVIDENCE_PIPELINE_CAPTURE=1 to write evidence pipeline verification JSON.",
)
def test_capture_evidence_pipeline_verification_json():
    real_outputs = _load_real_scrape_outputs()
    ideal_fixture = _load_ideal_fixture()
    targets = []

    for target_id, expected in ideal_fixture.items():
        actual_extract = real_outputs[target_id]["output"]
        actual_task = real_outputs[target_id]["task"]
        verdict = select_evidence(actual_extract)
        synthesis = synthesize_answer(actual_extract, actual_task)
        loyalty = loyalty_check(synthesis.answer, actual_extract)
        ideal_loyalty = loyalty_check(expected["synthesis"]["answer"], actual_extract)

        extract_checks = {
            "kind_exact": actual_extract.get("kind") == expected["extract"]["kind"],
            "confidence_within_tolerance": _within_confidence_tolerance(
                actual_extract.get("confidence", 0.0), expected["extract"]["confidence"]
            ),
            "wordCount_within_tolerance": _within_wordcount_tolerance(
                actual_extract.get("wordCount", 0), expected["extract"]["wordCount"]
            ),
            "structuredData_exact": actual_extract.get("structuredData") == expected["extract"]["structuredData"],
        }
        evidence_checks = {
            "usable_exact": verdict.usable is expected["evidence"]["usable"],
            "evidenceSource_exact": verdict.evidenceSource == expected["evidence"]["evidenceSource"],
        }
        synthesis_checks = {
            "answerSource_exact": synthesis.answerSource == expected["synthesis"]["answerSource"],
            "usedFallback_exact": synthesis.usedFallback is expected["synthesis"]["usedFallback"],
        }

        targets.append(
            {
                "id": target_id,
                "task": actual_task,
                "actual": {
                    "extract": actual_extract,
                    "evidenceVerdict": verdict.model_dump(),
                    "synthesis": synthesis.model_dump(),
                    "loyalty": loyalty.model_dump(),
                },
                "expected": expected,
                "checks": {
                    "extract": extract_checks,
                    "evidence": evidence_checks,
                    "synthesis": synthesis_checks,
                    "ideal_answer_loyal_to_actual_extract": ideal_loyalty.loyal,
                    "ideal_answer_loyalty": ideal_loyalty.model_dump(),
                },
            }
        )

    payload = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "captureMode": "evidence_pipeline_verification",
        "notes": [
            "This file compares the real scrape artifact against the ideal evidence pipeline fixture.",
            "Each target contains actual extract output, evidence selection verdict, synthesized answer, and loyalty check.",
            "Use the checks block to see exactly where the real pipeline diverges from the ideal fixture.",
        ],
        "targets": targets,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    assert OUTPUT_PATH.exists()
    assert len(targets) == len(ideal_fixture)

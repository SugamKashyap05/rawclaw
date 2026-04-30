import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.tools.builtin.web_extract import WebExtractTool


LIVE_CAPTURE_ENABLED = os.getenv("RAWCLAW_RUN_LIVE_WEB_CAPTURE") == "1"
ARTIFACT_PATH = Path(__file__).parent / "artifacts" / "web_scrape_capture.json"

SCRAPE_CAPTURE_TARGETS = [
    {
        "id": "example_domain",
        "url": "https://example.com/",
        "taskType": "page_read",
        "pageKind": "general",
        "backendOrder": ["reader", "web_fetch"],
    },
    {
        "id": "iana_reserved_domains",
        "url": "https://www.iana.org/domains/reserved",
        "taskType": "page_read",
        "pageKind": "general",
        "backendOrder": ["reader", "web_fetch"],
    },
    {
        "id": "times_of_india_homepage",
        "url": "https://timesofindia.indiatimes.com/",
        "taskType": "page_read",
        "pageKind": "general",
        "backendOrder": ["reader", "web_fetch"],
    },
    {
        "id": "ipl_points_table",
        "url": "https://www.iplt20.com/matches/points-table",
        "taskType": "factual_extract",
        "pageKind": "standings/table",
        "expectedFields": ["team", "position", "points", "nrr", "ranking_movement"],
        "backendOrder": ["web_fetch"],
    },
    {
        "id": "openai_changelog",
        "url": "https://developers.openai.com/api/docs/changelog",
        "taskType": "factual_extract",
        "pageKind": "docs/changelog",
        "expectedFields": ["update_items", "dates", "what_changed"],
        "backendOrder": ["reader", "web_fetch"],
    },
    {
        "id": "python_3144_release",
        "url": "https://www.python.org/downloads/release/python-3144/",
        "taskType": "page_read",
        "pageKind": "news/article",
        "expectedFields": ["event", "date_time", "what_changed"],
        "backendOrder": ["reader", "web_fetch"],
    },
]


@pytest.mark.asyncio
@pytest.mark.skipif(
    not LIVE_CAPTURE_ENABLED,
    reason="Set RAWCLAW_RUN_LIVE_WEB_CAPTURE=1 to run raw web scrape capture and write JSON artifacts.",
)
async def test_capture_raw_web_extract_outputs_to_json():
    tool = WebExtractTool()
    captures = []

    for target in SCRAPE_CAPTURE_TARGETS:
        result = await tool.execute(
            {
                "url": target["url"],
                "taskType": target["taskType"],
                "pageKind": target["pageKind"],
                "expectedFields": target.get("expectedFields", []),
                "backendOrder": target.get("backendOrder", []),
            }
        )
        captures.append(
            {
                "id": target["id"],
                "input": {
                    "url": target["url"],
                    "taskType": target["taskType"],
                    "pageKind": target["pageKind"],
                    "expectedFields": target.get("expectedFields", []),
                    "backendOrder": target.get("backendOrder", []),
                },
                "toolResult": result.model_dump(),
            }
        )

    payload = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "captureMode": "raw_web_extract_only",
        "notes": [
            "This file is a raw scraper artifact for inspection.",
            "No chat rendering or answer synthesis is involved here.",
            "Use this JSON to compare extractor output against conversation answers.",
        ],
        "targets": captures,
    }

    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    assert ARTIFACT_PATH.exists()
    assert len(captures) == len(SCRAPE_CAPTURE_TARGETS)

#!/usr/bin/env python
"""Replay scaffold for saved RawClaw research extraction diagnostics.

The first version is intentionally conservative: it finds saved
research_extract_diagnostic records in a log or JSON file, filters by session
when requested, and prints a deterministic summary that can be diffed in CI.
Hooking it into live extraction/synthesis code can build on the parsed records
without changing the command contract.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List


def _json_objects_from_line(line: str) -> Iterable[Dict[str, Any]]:
    candidates = [line.strip()]
    brace_index = line.find("{")
    if brace_index > 0:
        candidates.append(line[brace_index:].strip())
    for candidate in candidates:
        if not candidate:
            continue
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            yield value


def load_records(path: Path) -> List[Dict[str, Any]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    records: List[Dict[str, Any]] = []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None

    if isinstance(parsed, list):
        records.extend(item for item in parsed if isinstance(item, dict))
    elif isinstance(parsed, dict):
        records.append(parsed)
    else:
        for line in text.splitlines():
            records.extend(_json_objects_from_line(line))

    return [
        record
        for record in records
        if "research_extract_diagnostic" in json.dumps(record, sort_keys=True)
        or record.get("type") == "research_extract_diagnostic"
        or record.get("event") == "research_extract_diagnostic"
    ]


def session_matches(record: Dict[str, Any], session_id: str | None) -> bool:
    if not session_id:
        return True
    record_session = (
        record.get("session_id")
        or record.get("sessionId")
        or record.get("session")
        or (record.get("metadata") or {}).get("session_id")
        or (record.get("metadata") or {}).get("sessionId")
    )
    return str(record_session or "") == session_id


def summarize(record: Dict[str, Any]) -> Dict[str, Any]:
    payload = record.get("research_extract_diagnostic") if isinstance(record.get("research_extract_diagnostic"), dict) else record
    attempts = payload.get("attempts") or payload.get("backendAttempts") or []
    evidence = payload.get("evidence") or payload.get("search_evidence") or []
    return {
        "session_id": payload.get("session_id") or payload.get("sessionId") or record.get("session_id") or record.get("sessionId"),
        "query": payload.get("query") or payload.get("search_query") or "",
        "url": payload.get("url") or payload.get("requestedUrl") or "",
        "quality": payload.get("quality") or payload.get("fetch_quality") or payload.get("tier") or "",
        "attempt_count": len(attempts) if isinstance(attempts, list) else 0,
        "evidence_count": len(evidence) if isinstance(evidence, list) else 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay or summarize RawClaw research extraction diagnostics.")
    parser.add_argument("--diagnostic", required=True, help="Path to a backend log or JSON diagnostic file.")
    parser.add_argument("--session-id", default=None, help="Optional session id filter.")
    parser.add_argument("--dry-run", action="store_true", help="Parse and summarize without invoking live pipeline code.")
    args = parser.parse_args()

    path = Path(args.diagnostic)
    records = [record for record in load_records(path) if session_matches(record, args.session_id)]
    summaries = [summarize(record) for record in records]
    output = {
        "type": "REPLAY_RESULT",
        "dry_run": bool(args.dry_run),
        "diagnostic": str(path),
        "session_id": args.session_id,
        "record_count": len(records),
        "summaries": summaries,
    }
    print(f"[REPLAY_RESULT] {json.dumps(output, sort_keys=True)}")
    return 0 if records else 2


if __name__ == "__main__":
    raise SystemExit(main())

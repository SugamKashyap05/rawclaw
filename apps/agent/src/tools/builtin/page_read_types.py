import copy
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Literal, Optional


PAGE_READ_HTTP_DEFAULT_DURATION_MS = 10000
PAGE_READ_HTTP_MIN_DURATION_MS = 5000
PAGE_READ_HTTP_MAX_DURATION_MS = 30000
DEFAULT_MIN_CONTENT_CHARS = 200
LIVE_DATA_MIN_CONTENT_CHARS = 50
BROWSER_CAPABILITY_TRANSIENT_RETRIES = 1
BROWSER_CAPABILITY_FUTURE_WAIT_TIMEOUT_S = 5.0
BROWSER_SEMAPHORE_CAPACITY = 1
PAGE_READ_BROWSER_MAX_QUEUE_DEPTH = 3
PAGE_READ_FAILURE_SUMMARY_MAX_CHARS = 200
PAGE_READ_FAILURE_MARKER_RESERVE_CHARS = 12

URL_FIELD_NAMES = [
    "url",
    "uri",
    "link",
    "targetUrl",
    "target_url",
    "href",
    "address",
    "pageUrl",
    "page_url",
]

URL_FIELD_NAMES_LOWER = {name.lower(): name for name in URL_FIELD_NAMES}

BackendResult = Literal["success", "garbage", "failed", "skipped"]
EvidenceStatus = Literal["strong", "medium", "degraded", "failed"]


@dataclass
class CapabilityOutcome:
    status: Literal["success", "transient_error"]
    value: bool


@dataclass
class PageReadContext:
    url: str
    user_query: str
    task_type: str = "page_read"
    source_mode: str = "user_named"
    page_kind: str = "unknown"
    js_render_suspected: bool = False
    min_content_chars: int = DEFAULT_MIN_CONTENT_CHARS


@dataclass
class PageReadResult:
    kind: str = "content"
    url: str = ""
    title: str = ""
    content: str = ""
    structuredData: Dict[str, Any] = field(default_factory=dict)
    backendUsed: str = "none"
    backendResult: BackendResult = "failed"
    evidenceStatus: EvidenceStatus = "failed"
    backendAttempts: List[Dict[str, Any]] = field(default_factory=list)
    failureChain: List[str] = field(default_factory=list)
    fallbackAttempted: bool = False
    isFallback: bool = False
    landed_url: Optional[str] = None
    quality: str = "extract_garbage"
    tier: str = "failed"
    confidence: float = 0.0
    wordCount: int = 0
    pageKind: str = "unknown"
    jsRenderSuspected: bool = False
    minContentChars: int = DEFAULT_MIN_CONTENT_CHARS
    error: Optional[str] = None
    pageReadOrchestrated: bool = True

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


BEHAVIOR_SCHEMA_KEYS = {
    "$ref",
    "type",
    "properties",
    "required",
    "enum",
    "const",
    "items",
    "additionalProperties",
    "oneOf",
    "anyOf",
    "allOf",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
}


def normalize_behavior_schema(value: Any) -> Any:
    if isinstance(value, dict):
        normalized: Dict[str, Any] = {}
        for key in sorted(value.keys()):
            if key not in BEHAVIOR_SCHEMA_KEYS:
                continue
            item = value[key]
            if key == "properties" and isinstance(item, dict):
                normalized[key] = {
                    str(prop_key): normalize_behavior_schema(prop_schema)
                    for prop_key, prop_schema in sorted(item.items(), key=lambda pair: str(pair[0]))
                }
            elif key in {"required", "enum"} and isinstance(item, list):
                if all(isinstance(entry, (str, int, float, bool, type(None))) for entry in item):
                    normalized[key] = sorted(item, key=lambda entry: json.dumps(entry, sort_keys=True))
                else:
                    normalized[key] = [normalize_behavior_schema(entry) for entry in item]
            elif key in {"oneOf", "anyOf", "allOf"} and isinstance(item, list):
                entries = [normalize_behavior_schema(entry) for entry in item]
                normalized[key] = sorted(
                    entries,
                    key=lambda entry: json.dumps(entry, sort_keys=True, separators=(",", ":")),
                )
            else:
                normalized[key] = normalize_behavior_schema(item)
        return normalized
    if isinstance(value, list):
        return [normalize_behavior_schema(entry) for entry in value]
    return value


def schema_behavior_hash(schema: Dict[str, Any]) -> str:
    normalized = normalize_behavior_schema(schema or {})
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _schema_properties(schema: Dict[str, Any]) -> Dict[str, Any]:
    properties = schema.get("properties")
    return properties if isinstance(properties, dict) else {}


def find_url_field(schema: Dict[str, Any]) -> Optional[str]:
    properties = _schema_properties(schema or {})
    lowered = {str(key).lower(): str(key) for key in properties.keys()}
    required_raw = (schema or {}).get("required")
    required = [str(item) for item in required_raw] if isinstance(required_raw, list) else []
    required_lowered = {item.lower(): item for item in required}

    required_matches = [name for name in URL_FIELD_NAMES if name.lower() in required_lowered]
    if required_matches:
        return required_lowered[required_matches[0].lower()]

    for name in URL_FIELD_NAMES:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


def schema_accepts_url(schema: Dict[str, Any]) -> bool:
    if find_url_field(schema):
        return True
    for key in ("oneOf", "anyOf", "allOf"):
        entries = (schema or {}).get(key)
        if isinstance(entries, list) and any(isinstance(entry, dict) and schema_accepts_url(entry) for entry in entries):
            return True
    return False


def normalize_backend_attempt(
    *,
    attempt_seq: int,
    backend: str,
    result: BackendResult,
    error: Optional[str] = None,
    duration_ms: Optional[int] = None,
    **extra: Any,
) -> Dict[str, Any]:
    attempt = {
        "attemptSeq": attempt_seq,
        "backend": backend,
        "result": result,
        "error": error,
        "durationMs": duration_ms,
    }
    attempt.update(extra)
    return attempt


def aggregate_backend_result(attempts: List[Dict[str, Any]]) -> BackendResult:
    non_skipped = [attempt for attempt in attempts if attempt.get("result") != "skipped"]
    if any(attempt.get("result") == "success" for attempt in non_skipped):
        return "success"
    if non_skipped:
        latest = max(non_skipped, key=lambda attempt: int(attempt.get("attemptSeq") or 0))
        result = str(latest.get("result") or "failed")
        return result if result in {"success", "garbage", "failed", "skipped"} else "failed"  # type: ignore[return-value]
    return "skipped"


def is_strong_evidence(output: Dict[str, Any]) -> bool:
    return (
        str(output.get("quality") or "") in {"extract_clean", "extract_partial"}
        and str(output.get("tier") or "") in {"clean", "partial"}
        and float(output.get("confidence") or 0.0) >= 0.75
        and int(output.get("wordCount") or 0) >= 80
    )


def has_weak_signal(output: Dict[str, Any]) -> bool:
    if is_strong_evidence(output):
        return False
    return (
        str(output.get("quality") or "") == "extract_garbage"
        or str(output.get("tier") or "") in {"thin", "failed"}
        or float(output.get("confidence") or 0.0) < 0.6
        or int(output.get("wordCount") or 0) < 80
        or bool(output.get("jsRenderSuspected"))
        or bool(output.get("browserEscalationSuppressed"))
    )


def evidence_status_for_output(output: Dict[str, Any], *, fallback: bool = False, final_error: bool = False) -> EvidenceStatus:
    if final_error:
        return "failed"
    if fallback:
        return "degraded"
    if is_strong_evidence(output):
        return "strong"
    if has_weak_signal(output):
        return "degraded"
    return "medium"


def clamp_page_read_duration_ms(value: Optional[Any]) -> int:
    if value is None:
        return PAGE_READ_HTTP_DEFAULT_DURATION_MS
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return PAGE_READ_HTTP_DEFAULT_DURATION_MS
    return max(PAGE_READ_HTTP_MIN_DURATION_MS, min(PAGE_READ_HTTP_MAX_DURATION_MS, parsed))


def summarize_failure_chain(
    chain: List[str],
    *,
    fallback_unavailable: bool = False,
    max_chars: int = PAGE_READ_FAILURE_SUMMARY_MAX_CHARS,
) -> str:
    if not chain:
        return "[Search fallback unavailable]" if fallback_unavailable else "[Search fallback - direct page unavailable] no failure details recorded"

    first = str(chain[0])
    if len(first) > max_chars:
        return first[: max_chars - 3] + "..."

    kept = [first]
    remaining = [str(item) for item in chain[1:]]
    for idx, segment in enumerate(remaining):
        omitted_after = len(remaining) - idx - 1
        marker = f"[+{min(omitted_after, 99)} more]" if omitted_after else ""
        candidate = " -> ".join(kept + [segment])
        if marker:
            candidate_with_marker = f"{candidate} {marker}"
        else:
            candidate_with_marker = candidate
        if len(candidate_with_marker) <= max_chars:
            kept.append(segment)
            continue
        omitted = len(remaining) - idx
        marker = f"[+{min(omitted, 99)} more]"
        result = " -> ".join(kept)
        if len(f"{result} {marker}") <= max_chars:
            return f"{result} {marker}"
        trimmed = result[: max_chars - len(marker) - 1].rstrip()
        return f"{trimmed} {marker}"
    return " -> ".join(kept)


def provenance_subset(output: Dict[str, Any]) -> Dict[str, Any]:
    keys = [
        "backendUsed",
        "backendResult",
        "backendAttempts",
        "failureChain",
        "fallbackAttempted",
        "isFallback",
        "landed_url",
        "quality",
        "tier",
        "confidence",
        "wordCount",
        "evidenceStatus",
    ]
    return {key: copy.deepcopy(output.get(key)) for key in keys if key in output}


UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
OPAQUE_ID_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{20,}$")


def meaningful_slug_segments(path: str, limit: int = 2) -> List[str]:
    segments = [segment.strip() for segment in re.split(r"/+", path or "") if segment.strip()]
    meaningful: List[str] = []
    for segment in reversed(segments):
        if re.fullmatch(r"\d+", segment):
            continue
        if UUID_RE.fullmatch(segment):
            continue
        if OPAQUE_ID_RE.fullmatch(segment):
            continue
        meaningful.append(re.sub(r"[-_]+", " ", segment))
        if len(meaningful) >= limit:
            break
    return list(reversed(meaningful))


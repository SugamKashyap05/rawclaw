import re
from typing import Any, Dict, Iterable, List, Literal, Optional, Set, Tuple

from pydantic import BaseModel, Field

try:
    import ftfy
except ImportError:  # pragma: no cover - optional dependency
    ftfy = None


class EvidenceVerdict(BaseModel):
    usable: bool
    reason: str
    tier: str
    confidence: float
    evidenceSource: Literal["page_content", "structured_data", "none"]
    warningFlags: List[str] = Field(default_factory=list)


class SynthesisResult(BaseModel):
    answer: str
    answerSource: Literal["structured_data", "page_content", "fallback_refused"]
    groundedFields: List[str] = Field(default_factory=list)
    usedFallback: bool = False
    fallbackReason: Optional[str] = None


class LoyaltyResult(BaseModel):
    loyal: bool
    score: float
    violations: List[str] = Field(default_factory=list)
    checkedClaims: int = 0
    supportedClaims: int = 0


NAV_LINE_MARKERS = {
    "about", "downloads", "download", "community", "news", "events", "docs",
    "documentation", "success", "stories", "jobs", "forums", "shop", "help",
    "windows", "macos", "linux", "source", "code", "license", "other", "platforms",
}

ENTITY_STOP_WORDS = {
    "This", "That", "These", "Those", "Based", "Content", "Reason", "Page",
    "JavaScript", "Structured", "Data", "Note", "Full", "Current", "Latest",
    "Their",
    "Visible",
}


def _word_count(extract_output: Dict[str, Any]) -> int:
    explicit = extract_output.get("wordCount")
    if explicit is not None:
        try:
            return int(explicit)
        except (TypeError, ValueError):
            pass
    return len(str(extract_output.get("content") or "").split())


def _structured_record_count(extract_output: Dict[str, Any]) -> int:
    explicit = extract_output.get("structuredRecordCount")
    if explicit is not None:
        try:
            return int(explicit)
        except (TypeError, ValueError):
            pass
    count = 0
    for value in (extract_output.get("structuredData") or {}).values():
        if isinstance(value, list):
            count += len([item for item in value if str(item).strip()])
        elif isinstance(value, dict):
            count += len([item for item in value.values() if str(item).strip()])
        elif str(value or "").strip():
            count += 1
    return count


def select_evidence(extract_output: Dict[str, Any]) -> EvidenceVerdict:
    kind = str(extract_output.get("kind") or "").strip().lower()
    tier = str(extract_output.get("tier") or "failed").strip().lower() or "failed"
    confidence = float(extract_output.get("confidence") or 0.0)
    word_count = _word_count(extract_output)
    structured_record_count = _structured_record_count(extract_output)
    js_fallback = bool(extract_output.get("jsFallbackDetected"))
    warning_flags: List[str] = []

    if kind == "transport_failure":
        return EvidenceVerdict(
            usable=False,
            reason=f"transport_failure: {extract_output.get('fetchFailureKind') or 'unknown'}",
            tier=tier,
            confidence=confidence,
            evidenceSource="none",
            warningFlags=[],
        )

    if kind == "content" and word_count == 0:
        return EvidenceVerdict(
            usable=False,
            reason="empty_body: page requires JavaScript rendering",
            tier=tier,
            confidence=confidence,
            evidenceSource="none",
            warningFlags=[],
        )

    if kind == "content" and structured_record_count >= 3:
        if js_fallback:
            warning_flags.append("js_fallback: content may be incomplete")
        return EvidenceVerdict(
            usable=True,
            reason=f"{structured_record_count} structured records extracted",
            tier=tier,
            confidence=confidence,
            evidenceSource="structured_data",
            warningFlags=warning_flags,
        )

    if tier == "clean" and confidence >= 0.8 and word_count >= 50:
        if js_fallback:
            warning_flags.append("js_fallback: content may be incomplete")
        return EvidenceVerdict(
            usable=True,
            reason=f"clean extract: {word_count} words, confidence {confidence}",
            tier=tier,
            confidence=confidence,
            evidenceSource="page_content",
            warningFlags=warning_flags,
        )

    if tier == "partial" and confidence >= 0.6 and word_count >= 100:
        warning_flags.append("partial_content: answer may be incomplete")
        if js_fallback:
            warning_flags.append("js_fallback: content may be incomplete")
        return EvidenceVerdict(
            usable=True,
            reason=f"partial extract: {word_count} words, confidence {confidence}",
            tier=tier,
            confidence=confidence,
            evidenceSource="page_content",
            warningFlags=warning_flags,
        )

    return EvidenceVerdict(
        usable=False,
        reason=f"insufficient content: tier={tier}, confidence={confidence}, wordCount={word_count}",
        tier=tier,
        confidence=confidence,
        evidenceSource="none",
        warningFlags=[],
    )


def _flatten_structured_values(value: Any) -> List[str]:
    if isinstance(value, dict):
        flattened: List[str] = []
        for nested in value.values():
            flattened.extend(_flatten_structured_values(nested))
        return flattened
    if isinstance(value, list):
        flattened = []
        for nested in value:
            flattened.extend(_flatten_structured_values(nested))
        return flattened
    text = str(value or "").strip()
    return [text] if text else []


def _split_sentences(content: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", str(content or "").strip())
    return [part.strip() for part in parts if part and part.strip()]


def _is_nav_like(sentence: str) -> bool:
    tokens = [token.strip(".,:;!?()[]{}\"'").lower() for token in sentence.split()]
    if len(tokens) < 3:
        return False
    nav_hits = [token for token in tokens if token in NAV_LINE_MARKERS]
    return len(nav_hits) / max(len(tokens), 1) > 0.6


def _structured_answer(structured: Dict[str, Any], task: str, js_fallback: bool) -> Tuple[str, List[str]]:
    grounded_fields: List[str] = []

    if structured.get("team") and structured.get("points") and structured.get("nrr"):
        grounded_fields.extend(["team", "points", "nrr"])
        position = str(structured.get("position") or "").strip()
        answer = (
            f"{structured['team']} are on {structured['points']} points"
            f"{f' and sit {position} in the table' if position else ''}. "
            f"Their net run rate is {structured['nrr']}."
        )
        movement = structured.get("ranking_movement")
        if movement:
            grounded_fields.append("ranking_movement")
            if isinstance(movement, list):
                answer += f" Recent form: {', '.join(str(item) for item in movement[:5])}."
            else:
                answer += f" Recent form: {movement}."
        return answer, grounded_fields

    page_items = structured.get("page_items") or structured.get("headlines") or []
    if isinstance(page_items, list) and page_items:
        grounded_fields.append("page_items")
        selected = [str(item).strip() for item in page_items if str(item).strip()][:2]
        answer = "This page highlights: " + "; ".join(selected) + "."
        sections = structured.get("sections") or []
        if isinstance(sections, list) and sections:
            grounded_fields.append("sections")
            answer += f" Visible sections include {', '.join(str(item) for item in sections[:3])}."
        return answer, grounded_fields

    for key, value in structured.items():
        flattened = _flatten_structured_values(value)
        if flattened:
            grounded_fields.append(key)
    if grounded_fields:
        parts = [f"{field}: {', '.join(_flatten_structured_values(structured[field])[:3])}" for field in grounded_fields[:4]]
        return "Structured page evidence: " + "; ".join(parts) + ".", grounded_fields

    return "This page exposed structured data, but it did not contain enough directly answerable fields.", grounded_fields


def _page_content_answer(content: str, task: str, js_fallback: bool) -> str:
    sentences = [sentence for sentence in _split_sentences(content) if not _is_nav_like(sentence)]
    max_sentences = 8 if str(task or "").strip().lower() == "page_read" else 5
    core = " ".join(sentences[:max_sentences]).strip()
    if not core:
        core = str(content or "").strip()
    if js_fallback:
        return f"{core} Note: this page served a no-JavaScript fallback, so the content may be incomplete."
    return core


def synthesize_answer(extract_output: Dict[str, Any], task: str) -> SynthesisResult:
    verdict = select_evidence(extract_output)
    js_fallback = bool(extract_output.get("jsFallbackDetected"))

    if verdict.evidenceSource == "none":
        reason = verdict.reason
        if "empty_body" in reason:
            answer = "This page could not be extracted into readable content because it returned an empty body and requires JavaScript rendering."
        else:
            answer = f"This page could not be fetched or extracted. Reason: {reason}"
        return SynthesisResult(
            answer=answer,
            answerSource="fallback_refused",
            groundedFields=[],
            usedFallback=True,
            fallbackReason=reason,
        )

    if verdict.evidenceSource == "structured_data":
        answer, grounded_fields = _structured_answer(extract_output.get("structuredData") or {}, task, js_fallback)
        if js_fallback:
            answer += " Note: the page served fallback content, so some details may be incomplete."
        return SynthesisResult(
            answer=answer,
            answerSource="structured_data",
            groundedFields=grounded_fields,
            usedFallback=False,
            fallbackReason=None,
        )

    answer = _page_content_answer(str(extract_output.get("content") or ""), task, js_fallback)
    return SynthesisResult(
        answer=answer,
        answerSource="page_content",
        groundedFields=["content"],
        usedFallback=False,
        fallbackReason=None,
    )


def _normalize_text(text: str) -> str:
    raw = str(text or "")
    if ftfy is not None:
        normalized = ftfy.fix_text(raw)
    else:
        normalized = raw
        if any(marker in raw for marker in ["â€œ", "â€", "â€™", "â€“", "â€”", "Ã"]):
            try:
                normalized = raw.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore")
            except Exception:
                normalized = raw.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
    return re.sub(r"\s+", " ", normalized.strip().lower())


def _iter_source_values(extract_output: Dict[str, Any]) -> Iterable[str]:
    yield str(extract_output.get("title") or "")
    yield str(extract_output.get("content") or "")
    for value in _flatten_structured_values(extract_output.get("structuredData") or {}):
        yield value


def _source_corpus(extract_output: Dict[str, Any]) -> str:
    return " ".join(_iter_source_values(extract_output)).strip()


def _extract_claims(answer: str) -> List[Tuple[str, str]]:
    claims: List[Tuple[str, str]] = []
    seen: Set[Tuple[str, str]] = set()

    def add(kind: str, value: str) -> None:
        cleaned = str(value or "").strip()
        normalized = _normalize_text(cleaned)
        if not normalized or len(normalized) <= 2:
            return
        if cleaned in ENTITY_STOP_WORDS:
            return
        key = (kind, normalized)
        if key in seen:
            return
        seen.add(key)
        claims.append((kind, cleaned))

    for value in re.findall(r"\bpython\s+\d+\.\d+(?:\.\d+)*\b", answer, flags=re.IGNORECASE):
        add("entity", value)

    for value in re.findall(r"\bv?\d+\.\d+(?:\.\d+)*\b", answer):
        add("version", value)

    for value in re.findall(r"\bPEP\s+\d+\b", answer, flags=re.IGNORECASE):
        add("spec", value)

    for value in re.findall(r"\bRFC\s+\d+\b", answer, flags=re.IGNORECASE):
        add("spec", value)

    for value in re.findall(r"\b[a-z0-9-]+\.(?:com|org|net|io)\b", answer, flags=re.IGNORECASE):
        add("domain", value)

    for value in re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b", answer):
        add("entity", value)

    for value in re.findall(r"\b[A-Z][A-Za-z]*[A-Z][A-Za-z]*\b", answer):
        add("entity", value)

    for value in re.findall(r"\b[A-Z]{2,}\b", answer):
        if value.upper() in {"RFC", "PEP"}:
            continue
        add("entity", value)

    for value in re.findall(r'"([^"]{3,})"', answer):
        add("quoted", value)

    month_pattern = (
        r"\b(?:January|February|March|April|May|June|July|August|"
        r"September|October|November|December)\s+\d{1,2},?\s+\d{4}\b"
    )
    for value in re.findall(month_pattern, answer, flags=re.IGNORECASE):
        add("date", value)

    return claims


def _sentence_for_claim(answer: str, claim: str) -> str:
    for sentence in _split_sentences(answer):
        if claim.lower() in sentence.lower():
            return sentence
    return answer


def _numbers_from_text(text: str) -> List[float]:
    values: List[float] = []
    for match in re.findall(r"\b\d+(?:\.\d+)?\b", text):
        try:
            values.append(float(match))
        except ValueError:
            continue
    return values


def _claim_supported(kind: str, claim: str, answer: str, extract_output: Dict[str, Any]) -> bool:
    corpus = _normalize_text(_source_corpus(extract_output))
    normalized_claim = _normalize_text(claim)
    if normalized_claim and normalized_claim in corpus:
        return True

    if kind in {"number", "version"}:
        sentence = _sentence_for_claim(answer, claim).lower()
        if any(token in sentence for token in ["bug", "bugs", "bugfix", "fix", "fixes", "updates", "records", "items", "headlines"]):
            source_numbers = _numbers_from_text(corpus)
            try:
                claim_value = float(re.sub(r"(st|nd|rd|th)$", "", claim))
            except ValueError:
                return False
            for source_value in source_numbers:
                if source_value == 0:
                    continue
                if abs(claim_value - source_value) / source_value <= 0.2:
                    return True
        return False

    return False


def loyalty_check(answer: str, extract_output: Dict[str, Any]) -> LoyaltyResult:
    claims = _extract_claims(answer)
    if not claims:
        return LoyaltyResult(loyal=True, score=1.0, violations=[], checkedClaims=0, supportedClaims=0)

    violations: List[str] = []
    supported = 0
    for kind, claim in claims:
        if _claim_supported(kind, claim, answer, extract_output):
            supported += 1
        else:
            violations.append(f"claim not in extracted content: {claim}")

    checked = len(claims)
    score = round((supported / checked) if checked else 1.0, 3)
    loyal = score >= 0.8 and not violations
    return LoyaltyResult(
        loyal=loyal,
        score=score,
        violations=violations,
        checkedClaims=checked,
        supportedClaims=supported,
    )

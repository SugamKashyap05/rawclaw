"""Input sanitization for direct and retrieved prompt content."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger("rawclaw.security.input_sanitizer")

_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions",
    r"disregard\s+(all\s+)?(previous|prior)\s+(instructions|context)",
    r"act\s+as\s+(a\s+)?(?!user|assistant)",
    r"you\s+are\s+now\s+(?!a\s+helpful)",
    r"new\s+instructions?\s*:",
    r"system\s*:\s*you\s+(are|must|should)",
    r"<\|?(system|im_start|im_end)\|?>",
    r"\[INST\]|\[/INST\]|<s>|</s>",
]

_COMPILED_PATTERNS = [re.compile(pattern, re.IGNORECASE) for pattern in _INJECTION_PATTERNS]


def sanitize_user_input(text: str, turn_id: str) -> tuple[str, bool]:
    """
    Return sanitized user text and whether prompt-injection signatures appeared.

    This is a guardrail, not a primary policy engine: it strips known control
    phrases while preserving the user's ordinary request.
    """
    sanitized = str(text or "")
    flagged = False

    for pattern in _COMPILED_PATTERNS:
        if pattern.search(sanitized):
            flagged = True
            logger.warning(
                "prompt_injection_pattern_detected turn_id=%s pattern=%s",
                turn_id,
                pattern.pattern[:80],
            )
            sanitized = pattern.sub("[filtered]", sanitized)

    return sanitized, flagged


def sanitize_retrieved_chunk(chunk: str, collection: str, turn_id: str) -> tuple[str, bool]:
    """
    Treat RAG content as untrusted input before prompt injection.
    """
    sanitized, flagged = sanitize_user_input(chunk, turn_id)
    if flagged:
        logger.warning(
            "rag_chunk_injection_detected turn_id=%s collection=%s",
            turn_id,
            collection,
        )
    return sanitized, flagged

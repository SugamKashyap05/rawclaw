"""
Model capability manifest — static declarations for every model this system routes to.

RULE: Capabilities are declared here, NOT discovered at runtime.
If a model is not in this manifest, it must be added before the router will use it.
Runtime discovery is forbidden in the hot path — it adds latency and hides failures.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ModelCapability:
    model_id: str
    provider: str                    # "ollama" | "anthropic" | "minimax"
    tool_use: bool                   # supports function/tool calling
    max_context_tokens: int          # hard context window limit
    research_eligible: bool          # can be used in the research pipeline
    complexity_ceiling: str          # "low" | "medium" | "high" | "critical"
    supports_streaming: bool = True
    notes: str = ""


# ── Ollama local models ────────────────────────────────────────────────────────

OLLAMA_LLAMA3_2_3B = ModelCapability(
    model_id="ollama/llama3.2:3b",
    provider="ollama",
    tool_use=False,
    max_context_tokens=4096,
    research_eligible=False,
    complexity_ceiling="low",
    notes="Fast local model. Use for simple chat and single-turn Q&A only.",
)

OLLAMA_LLAMA3_2_1B = ModelCapability(
    model_id="ollama/llama3.2:1b",
    provider="ollama",
    tool_use=False,
    max_context_tokens=2048,
    research_eligible=False,
    complexity_ceiling="low",
    notes="Fastest local model. Simple completions only.",
)

OLLAMA_LLAMA3_1_8B = ModelCapability(
    model_id="ollama/llama3.1:8b",
    provider="ollama",
    tool_use=True,
    max_context_tokens=8192,
    research_eligible=False,
    complexity_ceiling="medium",
    notes="Capable local model. Tools work for simple schemas. Not for research pipeline.",
)

OLLAMA_LLAMA3_1_70B = ModelCapability(
    model_id="ollama/llama3.1:70b",
    provider="ollama",
    tool_use=True,
    max_context_tokens=32768,
    research_eligible=True,
    complexity_ceiling="high",
    notes="Full local model. Suitable for research and tool use.",
)

OLLAMA_MISTRAL_7B = ModelCapability(
    model_id="ollama/mistral:7b",
    provider="ollama",
    tool_use=False,
    max_context_tokens=8192,
    research_eligible=False,
    complexity_ceiling="medium",
    notes="Mistral 7B. Good for text tasks, not reliable for tool calling.",
)

OLLAMA_GEMMA4_E4B = ModelCapability(
    model_id="ollama/gemma4:e4b",
    provider="ollama",
    tool_use=False,
    max_context_tokens=8192,
    research_eligible=False,
    complexity_ceiling="low",
    notes="Fast local Gemma. Good for plain chat, not reliable for tool-heavy turns.",
)

OLLAMA_GEMMA4_31B_CLOUD = ModelCapability(
    model_id="ollama/gemma4:31b-cloud",
    provider="ollama",
    tool_use=True,
    max_context_tokens=32768,
    research_eligible=True,
    complexity_ceiling="high",
    notes="Primary heavy-capability Ollama route in this stack. Suitable for research and tool use.",
)

OLLAMA_QWEN3_VL_8B = ModelCapability(
    model_id="ollama/qwen3-vl:8b",
    provider="ollama",
    tool_use=True,
    max_context_tokens=16384,
    research_eligible=False,
    complexity_ceiling="medium",
    notes="Vision-capable local model. Acceptable for moderate tool work, not primary research route.",
)

OLLAMA_DEEPSEEK_R1_8B = ModelCapability(
    model_id="ollama/deepseek-r1:8b",
    provider="ollama",
    tool_use=False,
    max_context_tokens=16384,
    research_eligible=False,
    complexity_ceiling="medium",
    notes="Reasoning-oriented local model. Keep to text-only tasks without tool pressure.",
)

# ── Cloud models ───────────────────────────────────────────────────────────────

ANTHROPIC_CLAUDE_SONNET = ModelCapability(
    model_id="anthropic/claude-sonnet-4-20250514",
    provider="anthropic",
    tool_use=True,
    max_context_tokens=200000,
    research_eligible=True,
    complexity_ceiling="critical",
    notes="Primary cloud model. Use for all high-complexity and research tasks.",
)

ANTHROPIC_CLAUDE_HAIKU = ModelCapability(
    model_id="anthropic/claude-haiku-4-5-20251001",
    provider="anthropic",
    tool_use=True,
    max_context_tokens=200000,
    research_eligible=True,
    complexity_ceiling="high",
    notes="Fast cloud model. Good balance of speed and capability.",
)

# ── Registry ───────────────────────────────────────────────────────────────────

CAPABILITY_MANIFEST: dict[str, ModelCapability] = {
    m.model_id: m for m in [
        OLLAMA_LLAMA3_2_3B,
        OLLAMA_LLAMA3_2_1B,
        OLLAMA_LLAMA3_1_8B,
        OLLAMA_LLAMA3_1_70B,
        OLLAMA_MISTRAL_7B,
        OLLAMA_GEMMA4_E4B,
        OLLAMA_GEMMA4_31B_CLOUD,
        OLLAMA_QWEN3_VL_8B,
        OLLAMA_DEEPSEEK_R1_8B,
        ANTHROPIC_CLAUDE_SONNET,
        ANTHROPIC_CLAUDE_HAIKU,
    ]
}


def _canonical_model_id(model_id: str) -> str:
    raw = str(model_id or "").strip()
    if not raw:
        return raw
    if "/" in raw:
        return raw
    if raw.startswith("claude-"):
        return f"anthropic/{raw}"
    return f"ollama/{raw}"


def get_capability(model_id: str) -> Optional[ModelCapability]:
    """Look up a model's declared capabilities. Returns None if not in manifest."""
    if model_id in CAPABILITY_MANIFEST:
        return CAPABILITY_MANIFEST[model_id]
    canonical = _canonical_model_id(model_id)
    return CAPABILITY_MANIFEST.get(canonical)


def is_eligible(model_id: str, requires_tools: bool, complexity: str) -> bool:
    """
    Return True if this model can handle the described task profile.
    Call this BEFORE routing — never route and then fall back on failure.
    """
    cap = get_capability(model_id)
    if cap is None:
        return False

    complexity_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
    task_rank = complexity_rank.get(complexity, 0)
    model_rank = complexity_rank.get(cap.complexity_ceiling, 0)

    if requires_tools and not cap.tool_use:
        return False
    if complexity == "critical" and not cap.research_eligible:
        return False
    if task_rank > model_rank:
        return False
    return True


# Add any new models here before the router will use them.
# Do NOT add runtime capability probing — update this file instead.

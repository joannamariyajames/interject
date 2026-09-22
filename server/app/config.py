"""Runtime configuration.

Everything has a working default so the demo runs with zero setup. Set
``LLM_API_KEY`` to swap the deterministic local engine for a real model.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ[key])
    except (KeyError, ValueError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ[key])
    except (KeyError, ValueError):
        return default


def _env_bool(key: str, default: bool) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # --- provider -------------------------------------------------------
    llm_api_key: str | None = field(default_factory=lambda: os.environ.get("LLM_API_KEY"))
    llm_base_url: str = field(
        default_factory=lambda: os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
    )
    llm_model: str = field(default_factory=lambda: os.environ.get("LLM_MODEL", "gpt-4o-mini"))

    # --- timing ---------------------------------------------------------
    # Token emission delay for the local engine. Slow enough that a human can
    # actually barge in mid-sentence, which is the whole point of the demo.
    token_delay_ms: int = field(default_factory=lambda: _env_int("TOKEN_DELAY_MS", 22))
    plan_step_ms: int = field(default_factory=lambda: _env_int("PLAN_STEP_MS", 90))
    retrieval_latency_ms: int = field(default_factory=lambda: _env_int("RETRIEVAL_LATENCY_MS", 260))
    tool_latency_ms: int = field(default_factory=lambda: _env_int("TOOL_LATENCY_MS", 180))

    # --- speculation ----------------------------------------------------
    speculation_enabled: bool = field(default_factory=lambda: _env_bool("SPECULATION", True))
    speculation_debounce_ms: int = field(default_factory=lambda: _env_int("SPEC_DEBOUNCE_MS", 110))
    speculation_min_chars: int = field(default_factory=lambda: _env_int("SPEC_MIN_CHARS", 12))
    # Deliberately loose. Scoring only has to pick a plausible candidate; the
    # runtime then verifies the speculated passages against the finished
    # utterance before using them, so a generous threshold costs a discarded
    # prefetch rather than a wrong answer.
    speculation_match_threshold: float = field(
        default_factory=lambda: _env_float("SPEC_MATCH_THRESHOLD", 0.45)
    )

    # --- harness --------------------------------------------------------
    tool_timeout_ms: int = field(default_factory=lambda: _env_int("TOOL_TIMEOUT_MS", 4000))
    max_tool_calls_per_turn: int = field(default_factory=lambda: _env_int("MAX_TOOL_CALLS", 4))
    strict_harness: bool = field(default_factory=lambda: _env_bool("STRICT_HARNESS", True))

    # --- session --------------------------------------------------------
    # Session-scoped memory only; no cross-session user profile is ever built.
    session_ttl_s: int = field(default_factory=lambda: _env_int("SESSION_TTL_S", 3600))
    max_turns_in_context: int = field(default_factory=lambda: _env_int("MAX_TURNS", 12))

    cors_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    )

    @property
    def use_real_llm(self) -> bool:
        return bool(self.llm_api_key)


settings = Settings()

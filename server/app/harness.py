"""The safety harness wrapped around the real-time agent.

The brief asks for "a solid harness around the real-time agent to produce safe
and reliable agentic structure". Concretely this layer guarantees four things,
and reports each decision to the UI so none of it is invisible:

1. **Admission control** - unknown tools, unknown parameters and effectful
   tools that need confirmation are refused before execution.
2. **Budgets** - a hard cap on tool calls per turn, so an interrupted-and-
   retried turn cannot amplify into a storm of side effects.
3. **Timeouts** - every call races a deadline, so one slow dependency cannot
   pin the event loop and destroy the interruption latency the demo promises.
4. **Cancellation safety** - ``asyncio.CancelledError`` is re-raised, never
   swallowed. A barge-in must be able to tear a tool call down.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .config import settings
from .tools import REGISTRY, Effect, ToolSpec


class HarnessRefusal(Exception):
    """Raised when the harness declines to run a call."""

    def __init__(self, verdict: str) -> None:
        super().__init__(verdict)
        self.verdict = verdict


@dataclass
class ToolOutcome:
    call_id: str
    name: str
    status: str            # allowed | blocked | ok | error | timeout
    verdict: str
    args: dict[str, Any]
    latency_ms: float
    result: Any = None


@dataclass
class TurnBudget:
    max_calls: int
    used: int = 0
    audit: list[ToolOutcome] = field(default_factory=list)

    @property
    def exhausted(self) -> bool:
        return self.used >= self.max_calls


_REDACT_KEYS = {"passenger", "email", "phone", "card", "token", "password"}


def redact(args: dict[str, Any]) -> dict[str, Any]:
    """Never echo anything that looks personal back onto the wire."""
    out: dict[str, Any] = {}
    for key, value in args.items():
        if key.lower() in _REDACT_KEYS:
            out[key] = "[redacted]"
        elif isinstance(value, str) and len(value) > 120:
            out[key] = value[:117] + "..."
        else:
            out[key] = value
    return out


class Harness:
    def __init__(self, strict: bool | None = None) -> None:
        self.strict = settings.strict_harness if strict is None else strict

    def new_budget(self) -> TurnBudget:
        return TurnBudget(max_calls=settings.max_tool_calls_per_turn)

    # -- admission -------------------------------------------------------
    def admit(self, name: str, args: dict[str, Any], budget: TurnBudget) -> ToolSpec:
        spec = REGISTRY.get(name)
        if spec is None:
            raise HarnessRefusal(f"Unknown tool {name!r}; not in the registry.")
        if budget.exhausted:
            raise HarnessRefusal(
                f"Tool budget exhausted ({budget.max_calls} calls this turn)."
            )
        unknown = set(args) - set(spec.params) - {"latency_ms"}
        if unknown and self.strict:
            raise HarnessRefusal(
                f"{name} received unexpected parameters: {', '.join(sorted(unknown))}."
            )
        if spec.effect is Effect.EXTERNAL and spec.confirm:
            raise HarnessRefusal(
                f"{name} is an irreversible external action and needs explicit human "
                "confirmation; the agent cannot self-authorise it."
            )
        return spec

    # -- execution -------------------------------------------------------
    async def call(self, name: str, budget: TurnBudget, **args: Any) -> ToolOutcome:
        call_id = uuid.uuid4().hex[:8]
        started = time.monotonic()

        def elapsed() -> float:
            return round((time.monotonic() - started) * 1000, 1)

        try:
            spec = self.admit(name, args, budget)
        except HarnessRefusal as refusal:
            outcome = ToolOutcome(
                call_id, name, "blocked", refusal.verdict, redact(args), elapsed()
            )
            budget.audit.append(outcome)
            return outcome

        budget.used += 1
        try:
            result = await asyncio.wait_for(
                spec.fn(**args), timeout=settings.tool_timeout_ms / 1000.0
            )
        except asyncio.CancelledError:
            # A barge-in tore this down. Record it, then let the cancellation
            # continue to propagate - swallowing it would strand the turn.
            budget.audit.append(
                ToolOutcome(call_id, name, "error", "Cancelled by interrupt.", redact(args), elapsed())
            )
            raise
        except asyncio.TimeoutError:
            outcome = ToolOutcome(
                call_id, name, "timeout",
                f"Exceeded {settings.tool_timeout_ms} ms deadline.", redact(args), elapsed(),
            )
            budget.audit.append(outcome)
            return outcome
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI, not hidden
            outcome = ToolOutcome(
                call_id, name, "error", f"{type(exc).__name__}: {exc}", redact(args), elapsed()
            )
            budget.audit.append(outcome)
            return outcome

        outcome = ToolOutcome(
            call_id, name, "ok", f"{spec.effect.value} call completed.",
            redact(args), elapsed(), result=result,
        )
        budget.audit.append(outcome)
        return outcome

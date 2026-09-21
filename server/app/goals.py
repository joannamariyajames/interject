"""Goal tracking.

The brief asks the agent to "cater to different changes in goals without losing
the relevant session context". That means a *stack*, not a single mutable
variable: when the user swerves ("actually, what's the refund policy?") the old
goal is parked, not destroyed, so it can be resumed once the detour is done.

Classification is intentionally rule-based and inspectable. Every decision that
reshapes the stack is surfaced to the UI with the rationale that produced it, so
a judge can see *why* the agent thought the goal changed.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .retrieval import tokenize
from .schemas import GoalAction


class GoalStatus(str, Enum):
    ACTIVE = "active"
    PARKED = "parked"
    DONE = "done"


@dataclass
class Goal:
    text: str
    goal_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    status: GoalStatus = GoalStatus.ACTIVE
    constraints: list[str] = field(default_factory=list)
    turns: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "goal_id": self.goal_id,
            "text": self.text,
            "status": self.status.value,
            "constraints": list(self.constraints),
            "turns": self.turns,
        }


_SWITCH_MARKERS = (
    "actually", "instead", "forget that", "forget it", "never mind", "nevermind",
    "scratch that", "change of plan", "different question", "new question",
    "on second thought", "wait,", "hold on", "let's do", "lets do", "switch to",
)
_REVERT_MARKERS = (
    "back to", "going back", "as i was saying", "anyway", "where were we",
    "continue with", "resume", "like i said before", "earlier question",
)
_REFINE_MARKERS = (
    "but", "also", "and can you", "make it", "except", "instead of that one",
    "narrow", "only the", "just the", "cheaper", "earlier", "later", "add",
    "without", "under", "more", "less", "prefer",
)
_CONTINUE_MARKERS = ("go on", "keep going", "and then", "carry on", "finish", "continue")

_CONSTRAINT = re.compile(
    r"\b(under|below|over|above|before|after|cheaper than|within|no more than)\s+[\w,.:]+",
    re.IGNORECASE,
)


def _overlap(a: str, b: str) -> float:
    """Jaccard overlap of stemmed content words."""
    ta, tb = set(tokenize(a)), set(tokenize(b))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


@dataclass
class Classification:
    action: GoalAction
    rationale: str
    confidence: float


class GoalTracker:
    """A stack of goals plus the rules that decide how each utterance moves it."""

    def __init__(self) -> None:
        self.stack: list[Goal] = []

    # -- inspection ------------------------------------------------------
    @property
    def active(self) -> Goal | None:
        for goal in reversed(self.stack):
            if goal.status is GoalStatus.ACTIVE:
                return goal
        return None

    def snapshot(self) -> list[dict[str, Any]]:
        return [g.to_dict() for g in self.stack]

    def clear(self) -> None:
        self.stack.clear()

    # -- classification --------------------------------------------------
    def classify(self, utterance: str) -> Classification:
        text = utterance.strip().lower()
        active = self.active

        if active is None:
            return Classification(GoalAction.PUSH, "First goal of the session.", 1.0)

        parked = [g for g in self.stack if g.status is GoalStatus.PARKED]
        if parked and any(m in text for m in _REVERT_MARKERS):
            return Classification(
                GoalAction.REVERT,
                "Utterance points back at an earlier goal; resuming the parked one.",
                0.8,
            )

        if any(text.startswith(m) or f" {m}" in text for m in _SWITCH_MARKERS):
            return Classification(
                GoalAction.SWITCH,
                "Explicit course-correction marker; parking the current goal.",
                0.9,
            )

        if any(m in text for m in _CONTINUE_MARKERS) and len(text) < 40:
            return Classification(
                GoalAction.CONTINUE, "Short continuation cue; same goal.", 0.75
            )

        similarity = _overlap(utterance, active.text)

        # A terse amendment ("make it under 6000", "but earlier") shares almost
        # no content words with the goal it amends, so this has to be checked
        # before the low-overlap rule below or every refinement reads as a
        # brand new goal.
        content_words = len(tokenize(utterance))
        if content_words <= 7 and any(
            text.startswith(m) or f" {m} " in f" {text} " for m in _REFINE_MARKERS
        ):
            return Classification(
                GoalAction.REFINE,
                "Short amendment with no new subject; applied to the active goal.",
                0.75,
            )
        if similarity >= 0.34:
            return Classification(
                GoalAction.REFINE if any(m in text for m in _REFINE_MARKERS) else GoalAction.CONTINUE,
                f"Shares {similarity:.0%} of its content words with the active goal.",
                min(0.5 + similarity, 0.95),
            )
        if similarity <= 0.08 and content_words >= 3:
            return Classification(
                GoalAction.SWITCH,
                f"Only {similarity:.0%} lexical overlap with the active goal; treating it as a new one.",
                0.7,
            )
        return Classification(
            GoalAction.REFINE,
            f"Partial overlap ({similarity:.0%}); refining the active goal in place.",
            0.6,
        )

    # -- mutation --------------------------------------------------------
    def apply(self, utterance: str, classification: Classification) -> Goal:
        action = classification.action
        constraints = [m.group(0).strip() for m in _CONSTRAINT.finditer(utterance)]

        if action is GoalAction.REVERT:
            for goal in reversed(self.stack):
                if goal.status is GoalStatus.PARKED:
                    goal.status = GoalStatus.ACTIVE
                    goal.turns += 1
                    for other in self.stack:
                        if other is not goal and other.status is GoalStatus.ACTIVE:
                            other.status = GoalStatus.DONE
                    return goal

        if action in (GoalAction.PUSH, GoalAction.SWITCH):
            for goal in self.stack:
                if goal.status is GoalStatus.ACTIVE:
                    # Parked, not dropped: session context survives the swerve.
                    goal.status = GoalStatus.PARKED
            goal = Goal(text=utterance.strip(), constraints=constraints)
            self.stack.append(goal)
            return goal

        active = self.active or Goal(text=utterance.strip())
        if active not in self.stack:
            self.stack.append(active)
        active.turns += 1
        if action is GoalAction.REFINE:
            for constraint in constraints:
                if constraint not in active.constraints:
                    active.constraints.append(constraint)
        return active

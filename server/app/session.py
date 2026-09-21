"""Session-scoped state.

Per the brief: session-scoped memory only, no cross-session user profile. The
store is an in-process dict keyed by socket-issued session id, and closing the
socket is what eventually retires it. Nothing is written to disk, ever.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .config import settings
from .goals import GoalTracker


@dataclass
class Checkpoint:
    """What the agent had achieved at the moment it was interrupted."""

    checkpoint_id: str
    turn_id: str
    goal_text: str
    partial_text: str
    evidence: list[dict[str, str]]
    plan_progress: str
    created_at: float = field(default_factory=time.monotonic)

    @property
    def kept_tokens(self) -> int:
        return len(self.partial_text.split())

    def summary(self) -> str:
        words = self.partial_text.split()
        if not words:
            return "Interrupted before any output was produced."
        tail = " ".join(words[-14:])
        return f"{self.kept_tokens} words kept, ending \"...{tail}\""


@dataclass
class Turn:
    turn_id: str
    role: str
    content: str
    status: str = "complete"
    modality: str = "text"


@dataclass
class Session:
    session_id: str
    goals: GoalTracker = field(default_factory=GoalTracker)
    turns: list[Turn] = field(default_factory=list)
    notes: dict[str, str] = field(default_factory=dict)
    checkpoint: Checkpoint | None = None
    created_at: float = field(default_factory=time.time)
    interruptions: int = 0
    resumes: int = 0

    def add_turn(self, turn: Turn) -> None:
        self.turns.append(turn)
        # Session-scoped context window; older turns simply fall away.
        excess = len(self.turns) - settings.max_turns_in_context * 2
        if excess > 0:
            del self.turns[:excess]

    def context(self) -> list[dict[str, str]]:
        return [
            {"role": "assistant" if t.role == "agent" else "user", "content": t.content}
            for t in self.turns[-settings.max_turns_in_context :]
            if t.content.strip()
        ]

    def save_checkpoint(
        self, turn_id: str, partial_text: str, evidence: list[dict[str, str]], plan_progress: str
    ) -> Checkpoint:
        goal = self.goals.active
        self.checkpoint = Checkpoint(
            checkpoint_id=uuid.uuid4().hex[:8],
            turn_id=turn_id,
            goal_text=goal.text if goal else "",
            partial_text=partial_text,
            evidence=evidence,
            plan_progress=plan_progress,
        )
        self.interruptions += 1
        return self.checkpoint

    def take_checkpoint(self) -> Checkpoint | None:
        cp, self.checkpoint = self.checkpoint, None
        return cp

    def reset(self) -> None:
        """Wipe everything. This is the only kind of memory the agent has."""
        self.goals.clear()
        self.turns.clear()
        self.notes.clear()
        self.checkpoint = None
        self.interruptions = 0
        self.resumes = 0

    def stats(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "turns": len(self.turns),
            "goals": len(self.goals.stack),
            "interruptions": self.interruptions,
            "resumes": self.resumes,
            "age_s": round(time.time() - self.created_at, 1),
        }


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get_or_create(self, session_id: str | None) -> Session:
        self._sweep()
        sid = session_id or uuid.uuid4().hex[:12]
        session = self._sessions.get(sid)
        if session is None:
            session = Session(session_id=sid)
            self._sessions[sid] = session
        return session

    def drop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _sweep(self) -> None:
        cutoff = time.time() - settings.session_ttl_s
        for sid in [s for s, sess in self._sessions.items() if sess.created_at < cutoff]:
            self._sessions.pop(sid, None)

    def __len__(self) -> int:
        return len(self._sessions)


store = SessionStore()

"""Keeping the conversation alive while the agent thinks.

Straight from the brief: "Keep user entertained and the conversation alive,
without loosing on logical depth and core functionality."

Dead air is what makes an assistant feel broken. A person who is thinking says
"hang on, let me check" - they do not go silent for two seconds. So while the
turn is planning, retrieving or reasoning, a side channel emits short spoken-
style lines that describe what is actually happening right now.

Two rules keep this honest rather than decorative:

* Filler never enters the transcript and is never fed back into context. It is
  ephemeral chatter, not part of the answer, so it cannot dilute logical depth.
* Every line is derived from the real stage and the real goal, so it never
  claims work that is not happening.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass

from .schemas import Stage

# Keyed by the stage actually in progress. {topic} is filled from the goal.
_LINES: dict[Stage, tuple[str, ...]] = {
    Stage.PLANNING: (
        "Right, let me work out how to approach {topic}.",
        "Give me a second to line this up.",
        "Okay - thinking about {topic}.",
    ),
    Stage.RETRIEVING: (
        "Pulling up what we have on {topic}.",
        "Checking the {topic} details now.",
        "One sec, finding the exact wording on this.",
    ),
    Stage.TOOLING: (
        "Running that through the checks.",
        "Just validating this before I use it.",
    ),
    Stage.REASONING: (
        "Got the details - working out what matters for you.",
        "Reading through it now.",
        "Nearly there, putting this together.",
    ),
    Stage.RECOVERING: (
        "Picking up from where we left off.",
        "Still got the earlier work, carrying on.",
    ),
}

_STOPWORDS = {
    "find", "me", "a", "an", "the", "what", "whats", "is", "are", "my", "i",
    "can", "you", "please", "tell", "about", "for", "on", "in", "to", "do",
    "does", "how", "much", "many", "get", "give", "want", "need", "would",
    "should", "which", "and", "or", "of", "it", "that", "this", "if", "when",
}


def topic_of(goal_text: str, fallback: str = "this") -> str:
    """A short noun-ish phrase to drop into a filler line."""
    words = [w.strip("?,.!").lower() for w in goal_text.split()]
    content = [w for w in words if w and w not in _STOPWORDS]
    if not content:
        return fallback
    return " ".join(content[:3])


@dataclass
class FillerVoice:
    """Picks lines without repeating itself back to back."""

    seed: int = 0

    def __post_init__(self) -> None:
        self._random = random.Random(self.seed or None)
        self._last: str | None = None

    def line(self, stage: Stage, topic: str) -> str | None:
        options = _LINES.get(stage)
        if not options:
            return None
        choices = [o for o in options if o != self._last] or list(options)
        template = self._random.choice(choices)
        self._last = template
        return template.format(topic=topic)


async def keep_alive(
    emit_line,
    current_stage,
    topic: str,
    first_delay_ms: int = 450,
    gap_ms: int = 1400,
    voice: FillerVoice | None = None,
) -> None:
    """Emit filler until cancelled.

    Runs as its own task so the turn it accompanies stays fully interruptible;
    cancelling the turn cancels this with it, and a barge-in silences the
    chatter in the same instant it stops the answer.
    """
    speaker = voice or FillerVoice()
    await asyncio.sleep(first_delay_ms / 1000.0)
    while True:
        line = speaker.line(current_stage(), topic)
        if line:
            await emit_line(line)
        await asyncio.sleep(gap_ms / 1000.0)

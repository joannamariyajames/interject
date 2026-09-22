"""Speculative retrieval: start fetching before the utterance ends.

"Full-duplex: begin retrieving before the utterance ends" is the hardest
constraint in the brief to fake, because it only pays off if the work is
genuinely started early and genuinely reused.

The manager keeps a small set of in-flight retrievals keyed by the partial text
that triggered them. When the final utterance lands we look for a speculation
whose query still plausibly matches. A hit means the retrieval was already
running (or finished) while the user was still talking, and the turn skips
straight past the retrieval latency. A miss cancels the wasted work
immediately - speculation must never delay the real path.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from .config import settings
from .retrieval import Hit, tokenize


@dataclass
class Speculation:
    query: str
    task: asyncio.Task[list[Hit]]
    started_ms: float
    finished_ms: float | None = None

    @property
    def elapsed_ms(self) -> float:
        end = self.finished_ms if self.finished_ms is not None else time.monotonic() * 1000
        return round(end - self.started_ms, 1)


@dataclass
class SpeculationResult:
    hits: list[Hit]
    hit: bool
    query: str
    saved_ms: float
    field_note: str = ""


def _similarity(candidate: str, final: str) -> float:
    """How much of the final utterance's topic the guess already covered.

    Deliberately not a prefix check. Every speculation is a prefix of what the
    user went on to say, so treating prefixes as perfect matches accepts the
    guess made before the user reached the noun - and then answers a question
    they never asked. Only shared content words count.
    """
    guess, target = set(tokenize(candidate)), set(tokenize(final))
    if not guess or not target:
        return 0.0
    return len(guess & target) / len(target)


class SpeculationManager:
    def __init__(
        self,
        runner: Callable[[str], Awaitable[list[Hit]]],
        max_inflight: int = 3,
    ) -> None:
        self._runner = runner
        self._max = max_inflight
        self._inflight: list[Speculation] = []
        self._last_query = ""
        self.hits = 0
        self.misses = 0

    @property
    def inflight(self) -> list[Speculation]:
        return list(self._inflight)

    def _prune(self) -> None:
        while len(self._inflight) > self._max:
            stale = self._inflight.pop(0)
            stale.task.cancel()

    def should_speculate(self, partial: str) -> bool:
        text = partial.strip()
        if not settings.speculation_enabled or len(text) < settings.speculation_min_chars:
            return False
        if text == self._last_query:
            return False
        # Only re-speculate once a new content word has actually appeared,
        # otherwise every keystroke spawns a task.
        return set(tokenize(text)) != set(tokenize(self._last_query))

    def speculate(self, partial: str) -> Speculation | None:
        if not self.should_speculate(partial):
            return None
        query = partial.strip()
        self._last_query = query
        spec = Speculation(
            query=query,
            task=asyncio.ensure_future(self._runner(query)),
            started_ms=time.monotonic() * 1000,
        )
        spec.task.add_done_callback(
            lambda _t, s=spec: setattr(s, "finished_ms", time.monotonic() * 1000)
        )
        self._inflight.append(spec)
        self._prune()
        return spec

    async def settle(self, final: str) -> SpeculationResult:
        """Resolve the final utterance against whatever was speculated."""
        best: Speculation | None = None
        best_score = 0.0
        for spec in self._inflight:
            score = _similarity(spec.query, final)
            if score > best_score:
                best, best_score = spec, score

        if best is None or best_score < settings.speculation_match_threshold:
            self.cancel_all()
            self.misses += 1
            note = (
                "no speculation in flight"
                if best is None
                else f"best guess only matched {best_score:.0%} of the final utterance"
            )
            return SpeculationResult([], False, best.query if best else "", 0.0, note)

        # Cancel the losers before awaiting the winner.
        for spec in self._inflight:
            if spec is not best:
                spec.task.cancel()
        self._inflight = [best]

        head_start = best.elapsed_ms
        try:
            hits = await best.task
        except asyncio.CancelledError:
            self._inflight.clear()
            self.misses += 1
            return SpeculationResult([], False, best.query, 0.0, "speculation was cancelled")
        except Exception as exc:  # noqa: BLE001
            self._inflight.clear()
            self.misses += 1
            return SpeculationResult([], False, best.query, 0.0, f"speculation failed: {exc}")

        self._inflight.clear()
        self.hits += 1
        saved = round(min(head_start, float(settings.retrieval_latency_ms)), 1)
        return SpeculationResult(
            hits, True, best.query, saved,
            f"matched {best_score:.0%} of the final utterance",
        )

    def cancel_all(self) -> None:
        for spec in self._inflight:
            spec.task.cancel()
        self._inflight.clear()

    def reset(self) -> None:
        self.cancel_all()
        self._last_query = ""

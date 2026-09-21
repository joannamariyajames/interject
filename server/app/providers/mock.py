"""Deterministic local engine.

The demo has to run with no API key and no network, and it has to be *slow
enough to interrupt*. This engine composes a grounded answer out of the
retrieved evidence and emits it token by token, with a real ``await`` between
tokens so a barge-in lands between two words rather than after the whole turn.
"""

from __future__ import annotations

import asyncio
import re
from typing import AsyncIterator

from ..config import settings
from ..retrieval import tokenize
from .base import GenerationRequest

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _relevant_sentences(text: str, query: str, limit: int = 2) -> list[str]:
    wanted = set(tokenize(query))
    scored: list[tuple[int, int, str]] = []
    for index, sentence in enumerate(_SENTENCE.split(" ".join(text.split()))):
        if len(sentence) < 25:
            continue
        overlap = len(wanted & set(tokenize(sentence)))
        if overlap:
            scored.append((overlap, -index, sentence.strip()))
    scored.sort(reverse=True)
    return [s for _, _, s in scored[:limit]]


class MockProvider:
    name = "local-deterministic"

    def plan(self, request: GenerationRequest) -> list[str]:
        steps = [f"Read the goal: {request.goal[:60]}"]
        if request.constraints:
            steps.append(f"Honour {len(request.constraints)} constraint(s): {', '.join(request.constraints)}")
        if request.resume_from:
            steps.append("Reuse the checkpoint instead of restarting")
        steps.append("Ground the answer in retrieved passages")
        steps.append("Draft, then hand control back to the user")
        return steps

    async def stream(self, request: GenerationRequest) -> AsyncIterator[str]:
        body = self._compose(request)
        delay = settings.token_delay_ms / 1000.0
        for token in re.findall(r"\S+\s*|\n", body):
            # The await is the cancellation point that makes barge-in possible.
            if delay:
                await asyncio.sleep(delay)
            yield token

    # -- composition -----------------------------------------------------
    def _compose(self, request: GenerationRequest) -> str:
        parts: list[str] = []

        if request.resume_from:
            tail = request.resume_from.strip().split()
            tail_text = " ".join(tail[-12:])
            parts.append(
                f"Picking up where I stopped - I had got as far as \"...{tail_text}\". Continuing from there.\n\n"
            )

        if request.notice:
            parts.append(f"{request.notice}\n\n")

        if request.modality == "voice":
            parts.append("(heard via voice transcript) ")
        elif request.modality == "image":
            parts.append("(reading the attached image alongside your question) ")

        evidence = request.evidence
        if not evidence:
            parts.append(
                f"I don't have anything in the corpus that covers \"{request.utterance.strip()}\" yet. "
                "I can still reason about it, but nothing below would be grounded - "
                "want me to answer from general knowledge instead?"
            )
            return "".join(parts)

        already_said = (request.resume_from or "").lower()

        if not request.resume_from:
            top = evidence[0]
            lead = _relevant_sentences(
                top["snippet"], request.utterance + " " + request.goal, limit=1
            )
            parts.append(
                f"On {top['title'].lower()}: {lead[0] if lead else top['snippet'][:160]}\n\n"
            )

        bullets: list[str] = []
        for item in evidence[:3]:
            for sentence in _relevant_sentences(item["snippet"], request.utterance, limit=1):
                # Don't repeat a point the interrupted half of the answer made.
                if sentence.lower()[:40] in already_said:
                    continue
                bullets.append(f"- {sentence}  [{item['doc_id']}]\n")

        if not bullets and request.resume_from:
            # Everything relevant was already said before the interruption, so
            # a resume would otherwise be nothing but preamble. Carry on with
            # the next passage instead of trailing off.
            for item in evidence:
                extra = _relevant_sentences(item["snippet"], request.goal, limit=1)
                for sentence in extra:
                    if sentence.lower()[:40] not in already_said:
                        bullets.append(f"- {sentence}  [{item['doc_id']}]\n")
                        break
                if bullets:
                    break

        parts.extend(bullets)

        if request.constraints:
            parts.append(
                f"\nI am holding these constraints from earlier in the session: "
                f"{'; '.join(request.constraints)}.\n"
            )

        parts.append(
            "\nWant me to narrow this down, or move on to the next part of the plan?"
        )
        return "".join(parts)

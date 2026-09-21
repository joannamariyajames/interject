from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol


@dataclass
class GenerationRequest:
    goal: str
    utterance: str
    constraints: list[str] = field(default_factory=list)
    context: list[dict[str, str]] = field(default_factory=list)
    evidence: list[dict[str, str]] = field(default_factory=list)
    resume_from: str | None = None
    modality: str = "text"
    # Set when the harness refused something the user asked for. The answer has
    # to say so rather than quietly pretending the request never happened.
    notice: str | None = None


class Provider(Protocol):
    name: str

    def plan(self, request: GenerationRequest) -> list[str]:
        """Short, human-readable plan steps shown in the UI while thinking."""

    def stream(self, request: GenerationRequest) -> AsyncIterator[str]:
        """Yield response chunks. Must be cancellable between chunks."""

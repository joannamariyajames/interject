"""Tool implementations.

Every tool is async and therefore cancellable. Each declares a side-effect
level that the harness enforces before the call is allowed to run.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
from typing import Any, Awaitable, Callable

from .retrieval import corpus


class Effect(str, Enum):
    """How much damage a tool can do if the agent is wrong about calling it."""

    READ = "read"          # safe, idempotent
    WRITE = "write"        # mutates session-scoped state
    EXTERNAL = "external"  # would leave the system; always needs confirmation


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    effect: Effect
    params: tuple[str, ...]
    fn: Callable[..., Awaitable[Any]]
    confirm: bool = False


async def _search_corpus(query: str, latency_ms: int = 0, **_: Any) -> dict[str, Any]:
    hits = await corpus.search_async(query, latency_ms=latency_ms, k=3)
    return {
        "query": query,
        "results": [
            {"doc_id": h.doc.doc_id, "title": h.doc.title, "snippet": h.doc.snippet, "score": h.score}
            for h in hits
        ],
    }


async def _price_quote(route: str = "", cabin: str = "economy", **_: Any) -> dict[str, Any]:
    await asyncio.sleep(0.12)
    base = {"economy": 5400, "flex": 8200, "business": 19600}.get(cabin.lower(), 5400)
    # Deterministic pseudo-variation so the demo reads the same on every run.
    bump = (sum(ord(c) for c in route) % 9) * 110
    return {"route": route or "unspecified", "cabin": cabin, "quote_inr": base + bump}

async def _session_note(key: str = "", value: str = "", **_: Any) -> dict[str, Any]:
    """Writes to session-scoped memory only. Nothing persists past the socket."""
    await asyncio.sleep(0.03)
    return {"stored": {key: value}, "scope": "session"}


async def _send_booking(**kwargs: Any) -> dict[str, Any]:
    # Deliberately never reachable without an explicit human confirmation.
    await asyncio.sleep(0.2)
    return {"status": "submitted", "echo": kwargs}


REGISTRY: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in (
        ToolSpec(
            name="search_corpus",
            description="Look up the travel corpus (fares, hotels, policy, support).",
            effect=Effect.READ,
            params=("query",),
            fn=_search_corpus,
        ),
        ToolSpec(
            name="price_quote",
            description="Estimate a fare for a route and cabin.",
            effect=Effect.READ,
            params=("route", "cabin"),
            fn=_price_quote,
        ),
        ToolSpec(
            name="session_note",
            description="Remember a preference for this session only.",
            effect=Effect.WRITE,
            params=("key", "value"),
            fn=_session_note,
        ),
        ToolSpec(
            name="send_booking",
            description="Actually ticket an itinerary. Irreversible.",
            effect=Effect.EXTERNAL,
            params=("route", "date", "passenger"),
            fn=_send_booking,
            confirm=True,
        ),
    )
}

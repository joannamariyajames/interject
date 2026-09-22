"""FastAPI surface: one full-duplex websocket plus a little metadata."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .retrieval import corpus
from .runtime import AgentRuntime
from .schemas import ErrorFrame, ServerFrame, Stage, StageFrame
from .session import store
from .tools import REGISTRY

app = FastAPI(
    title="Interject",
    description="An interruptible, full-duplex real-time agent.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins) + ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "provider": "openai-compatible" if settings.use_real_llm else "local-deterministic",
        "model": settings.llm_model if settings.use_real_llm else "deterministic",
        "corpus_documents": len(corpus.docs),
        "active_sessions": len(store),
        "speculation": settings.speculation_enabled,
        "strict_harness": settings.strict_harness,
    }


@app.get("/api/corpus")
async def list_corpus() -> dict[str, Any]:
    return {
        "documents": [
            {"doc_id": d.doc_id, "source": d.source, "title": d.title, "snippet": d.snippet}
            for d in corpus.docs
        ]
    }


@app.get("/api/tools")
async def list_tools() -> dict[str, Any]:
    return {
        "tools": [
            {
                "name": spec.name,
                "description": spec.description,
                "effect": spec.effect.value,
                "params": list(spec.params),
                "needs_confirmation": spec.confirm,
            }
            for spec in REGISTRY.values()
        ]
    }


@app.get("/api/transcripts")
async def transcripts() -> dict[str, Any]:
    """Canned speech transcripts for the simulated voice input.

    The brief allows voice to be simulated from transcripts. The client replays
    these word by word at a speaking cadence, emitting the same partial frames a
    real recogniser would, so the full-duplex path is exercised honestly rather
    than by pasting a finished sentence.
    """
    return {
        "transcripts": [
            {
                "id": "baggage",
                "label": "Baggage question",
                "text": "what are the baggage limits on each cabin",
                "wpm": 150,
            },
            {
                "id": "flight",
                "label": "Flight request",
                "text": "find me a flight from Bengaluru to Mumbai on Friday morning",
                "wpm": 165,
            },
            {
                "id": "refund",
                "label": "Mid-thought swerve",
                "text": "actually wait what happens to my refund if I cancel this",
                "wpm": 180,
            },
            {
                "id": "delay",
                "label": "Disruption",
                "text": "my flight is delayed overnight what am I entitled to",
                "wpm": 155,
            },
        ]
    }


@app.get("/api/scenarios")
async def scenarios() -> dict[str, Any]:
    """Scripted demos. The UI can replay these to show each behaviour on cue."""
    return {
        "scenarios": [
            {
                "id": "barge-in",
                "title": "Barge-in mid-answer",
                "blurb": "Interrupt while the agent is streaming, then continue. It picks up from the checkpoint instead of restarting.",
                "steps": [
                    {"kind": "say", "text": "What are the baggage limits on each cabin?"},
                    {"kind": "wait_tokens", "count": 14},
                    {"kind": "interrupt"},
                    {"kind": "say", "text": "go on"},
                ],
            },
            {
                "id": "goal-switch",
                "title": "Goal switch and return",
                "blurb": "Swerve to a different goal mid-task, then come back. The first goal is parked, not lost.",
                "steps": [
                    {"kind": "say", "text": "Find me a flight from Bengaluru to Mumbai on Friday"},
                    {"kind": "wait_idle"},
                    {"kind": "say", "text": "actually, what happens to my refund if I cancel?"},
                    {"kind": "wait_idle"},
                    {"kind": "say", "text": "anyway, back to the flight"},
                ],
            },
            {
                "id": "refine",
                "title": "Constraint accumulates",
                "blurb": "A terse amendment with no shared nouns still lands on the right goal.",
                "steps": [
                    {"kind": "say", "text": "Which hotel should I book in Mumbai?"},
                    {"kind": "wait_idle"},
                    {"kind": "say", "text": "make it under 9000 a night"},
                ],
            },
            {
                "id": "harness",
                "title": "Harness refuses an irreversible call",
                "blurb": "The agent cannot self-authorise a booking. The refusal is shown, not hidden.",
                "steps": [{"kind": "say", "text": "just book the ticket for me now"}],
            },
        ]
    }


@app.websocket("/ws")
async def websocket_endpoint(socket: WebSocket) -> None:
    await socket.accept()
    session = store.get_or_create(None)
    send_lock = asyncio.Lock()
    closed = False

    async def emit(frame: ServerFrame) -> None:
        nonlocal closed
        if closed:
            return
        try:
            async with send_lock:
                await socket.send_text(frame.model_dump_json())
        except (WebSocketDisconnect, RuntimeError):
            closed = True

    runtime = AgentRuntime(session, emit)

    await socket.send_text(
        json.dumps(
            {
                "t": "ready",
                "session_id": session.session_id,
                "provider": runtime.provider.name,
                "speculation": settings.speculation_enabled,
                "token_delay_ms": settings.token_delay_ms,
            }
        )
    )
    await emit(StageFrame(stage=Stage.IDLE, detail="Connected. Start talking."))

    try:
        while True:
            raw = await socket.receive_text()
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                await emit(ErrorFrame(message="Malformed frame ignored."))
                continue

            kind = event.get("t")
            # Note the ordering: interrupt is handled before anything that
            # could await, so a barge-in is never queued behind a turn.
            if kind == "interrupt":
                await runtime.interrupt(event.get("reason", "barge_in"))
            elif kind == "partial":
                await runtime.on_partial(str(event.get("text", "")))
            elif kind == "final":
                await runtime.on_final(
                    str(event.get("text", "")),
                    modality=event.get("modality", "text"),
                    attachment=event.get("attachment"),
                )
            elif kind == "resume":
                await runtime.resume()
            elif kind == "reset":
                await runtime.reset()
            elif kind == "config":
                runtime.configure(
                    token_delay_ms=event.get("token_delay_ms"),
                    strict_harness=event.get("strict_harness"),
                )
                await emit(StageFrame(stage=Stage.IDLE, detail="Settings applied."))
            elif kind == "ping":
                await emit(StageFrame(stage=Stage.IDLE, detail="pong"))
            else:
                await emit(ErrorFrame(message=f"Unknown frame {kind!r}."))
    except WebSocketDisconnect:
        pass
    finally:
        closed = True
        await runtime.shutdown()
        # Session-scoped memory: the socket closing is the end of it.
        store.drop(session.session_id)

"""The interruptible turn runtime.

One turn is one ``asyncio.Task``. Everything expensive inside it sits behind an
``await``, which is what makes a barge-in land between two tokens instead of
after the whole answer.

The rules that make interruption *clean* rather than merely fast:

* The turn task never emits from its own ``finally``. Cancellation unwinding is
  not a good place to be awaiting a socket. It records a checkpoint
  synchronously and dies; the socket reader - which was never cancelled - is
  what reports the interruption.
* A checkpoint keeps the partial answer, the retrieved evidence and how far the
  plan got. The next utterance decides what to do with it: continue from it,
  refine it, or park the whole goal and start a new one. Nothing is thrown away
  just because the user spoke.
* Time-to-yield is measured from the instant the interrupt frame is read to the
  instant the task is actually finished, and reported to the UI. If that number
  ever creeps up, something in the turn is blocking the event loop.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from typing import Any, Awaitable, Callable

from .config import settings
from .goals import GoalAction
from .harness import Harness, TurnBudget
from .providers import GenerationRequest, build_provider
from .retrieval import Hit, corpus
from .schemas import (
    CheckpointFrame,
    ErrorFrame,
    GoalFrame,
    MessageFrame,
    MetricFrame,
    ServerFrame,
    SpecFrame,
    Stage,
    StageFrame,
    TokenFrame,
    ToolFrame,
    now_ms,
)
from .session import Session, Turn
from .speculation import SpeculationManager

Emit = Callable[[ServerFrame], Awaitable[None]]


# Utterances that ask for a real-world side effect. The agent attempts the call
# so that the harness's refusal is a real event in the audit log, rather than a
# behaviour we merely claim in a README.
_ACTION_INTENT = re.compile(
    r"\b(book|ticket|purchase|buy|pay|confirm the booking|go ahead and book)\b", re.IGNORECASE
)


def _hits_to_evidence(hits: list[Hit]) -> list[dict[str, str]]:
    return [
        {"doc_id": h.doc.doc_id, "title": h.doc.title, "snippet": h.doc.snippet, "source": h.doc.source}
        for h in hits
    ]


class AgentRuntime:
    def __init__(self, session: Session, emit: Emit) -> None:
        self.session = session
        self.emit = emit
        self.provider = build_provider()
        self.harness = Harness()
        self.speculation = SpeculationManager(
            runner=lambda q: corpus.search_async(q, latency_ms=settings.retrieval_latency_ms)
        )

        self._task: asyncio.Task[None] | None = None
        self._turn_id: str = ""
        self._partial_out: str = ""
        self._evidence: list[dict[str, str]] = []
        self._plan_progress: str = "not started"
        self._token_delay = settings.token_delay_ms

    # ------------------------------------------------------------------
    # state
    # ------------------------------------------------------------------
    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    def configure(self, *, token_delay_ms: int | None = None, strict_harness: bool | None = None) -> None:
        if token_delay_ms is not None:
            self._token_delay = token_delay_ms
        if strict_harness is not None:
            self.harness.strict = strict_harness

    # ------------------------------------------------------------------
    # inbound events
    # ------------------------------------------------------------------
    async def on_partial(self, text: str) -> None:
        """A partial utterance arrived while the user is still speaking."""
        await self.emit(StageFrame(stage=Stage.LISTENING, detail=f"{len(text)} chars so far"))
        spec = self.speculation.speculate(text)
        if spec is not None:
            await self.emit(
                SpecFrame(
                    status="started",
                    query=spec.query,
                    saved_ms=0.0,
                )
            )

    async def on_final(self, text: str, modality: str = "text", attachment: str | None = None) -> None:
        if not text.strip():
            return
        if self.busy:
            # Speaking over the agent is itself the interrupt.
            await self.interrupt("barge_in")
        self._turn_id = uuid.uuid4().hex[:10]
        self._partial_out = ""
        self._plan_progress = "not started"
        self.session.add_turn(Turn(self._turn_id, "user", text, modality=modality))
        await self.emit(
            MessageFrame(
                turn_id=self._turn_id, role="user", content=text, modality=modality,
                meta={"attachment": attachment} if attachment else {},
            )
        )
        self._task = asyncio.ensure_future(self._run_turn(text, modality))

    async def interrupt(self, reason: str = "barge_in") -> None:
        task = self._task
        if task is None or task.done():
            await self.emit(StageFrame(stage=Stage.IDLE, detail="Nothing in flight to interrupt."))
            return

        started = now_ms()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass  # expected: we asked for it
        except Exception as exc:  # noqa: BLE001
            await self.emit(ErrorFrame(message=f"turn failed while stopping: {exc}"))
        time_to_yield = round(now_ms() - started, 1)
        self.speculation.cancel_all()

        checkpoint = self.session.checkpoint
        await self.emit(
            StageFrame(
                stage=Stage.INTERRUPTED,
                turn_id=self._turn_id,
                detail=(
                    "Barge-in: stopped mid-answer and kept the work."
                    if reason == "barge_in"
                    else "Stopped on request."
                ),
            )
        )
        if self._partial_out.strip():
            await self.emit(
                MessageFrame(
                    turn_id=self._turn_id, role="agent", content=self._partial_out,
                    status="interrupted",
                    meta={"reason": reason, "plan_progress": self._plan_progress},
                )
            )
        if checkpoint is not None:
            await self.emit(
                CheckpointFrame(
                    checkpoint_id=checkpoint.checkpoint_id,
                    turn_id=checkpoint.turn_id,
                    summary=checkpoint.summary(),
                    kept_tokens=checkpoint.kept_tokens,
                    retrieved_docs=[e["doc_id"] for e in checkpoint.evidence],
                    plan_progress=checkpoint.plan_progress,
                )
            )
        await self.emit(
            MetricFrame(
                name="time_to_yield", value=time_to_yield,
                note="interrupt received -> agent fully stopped",
            )
        )
        await self.emit(StageFrame(stage=Stage.IDLE, detail="Waiting for you."))

    async def resume(self) -> None:
        checkpoint = self.session.checkpoint
        if checkpoint is None:
            await self.emit(ErrorFrame(message="Nothing to resume.", recoverable=True))
            return
        await self.on_final("continue from where you stopped", modality="text")

    async def reset(self) -> None:
        if self.busy:
            await self.interrupt("stop")
        self.speculation.reset()
        self.session.reset()
        await self.emit(GoalFrame(action=GoalAction.COMPLETE, stack=[], rationale="Session cleared."))
        await self.emit(StageFrame(stage=Stage.IDLE, detail="Session memory cleared."))

    async def shutdown(self) -> None:
        if self.busy and self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self.speculation.cancel_all()

    # ------------------------------------------------------------------
    # the turn itself
    # ------------------------------------------------------------------
    async def _run_turn(self, utterance: str, modality: str) -> None:
        turn_id = self._turn_id
        interrupted = False
        try:
            # -- 1. goal bookkeeping ------------------------------------
            await self.emit(StageFrame(stage=Stage.PLANNING, turn_id=turn_id, detail="Placing the utterance against the goal stack"))
            classification = self.session.goals.classify(utterance)
            goal = self.session.goals.apply(utterance, classification)
            await self.emit(
                GoalFrame(
                    action=classification.action,
                    stack=self.session.goals.snapshot(),
                    rationale=classification.rationale,
                )
            )

            # -- 2. decide what to do with any checkpoint ---------------
            checkpoint = self.session.take_checkpoint()
            resume_from: str | None = None
            carried_evidence: list[dict[str, str]] = []
            if checkpoint is not None:
                if classification.action in (GoalAction.CONTINUE, GoalAction.REFINE):
                    resume_from = checkpoint.partial_text
                    carried_evidence = checkpoint.evidence
                    self.session.resumes += 1
                    await self.emit(
                        StageFrame(
                            stage=Stage.RECOVERING, turn_id=turn_id,
                            detail=f"Reusing {checkpoint.kept_tokens} words and "
                                   f"{len(carried_evidence)} passage(s) from the interrupted turn",
                        )
                    )
                    await self.emit(
                        MetricFrame(
                            name="recovered_tokens", value=float(checkpoint.kept_tokens),
                            unit="tokens", note="carried across the interruption instead of regenerated",
                        )
                    )
                else:
                    await self.emit(
                        StageFrame(
                            stage=Stage.RECOVERING, turn_id=turn_id,
                            detail="Goal changed - parking the interrupted answer, session context kept",
                        )
                    )

            # -- 3. retrieval, speculative if we can ---------------------
            # A terse follow-up ("make it under 9000", "anyway, back to the
            # flight") carries almost no topic of its own. Retrieving on those
            # words alone answers the wrong question, so the active goal and its
            # constraints are folded into the query. Only a self-contained
            # utterance is allowed to reuse a speculation, because speculation
            # ran against the raw partial text and knows nothing of the goal.
            self_contained = classification.action in (GoalAction.PUSH, GoalAction.SWITCH)
            if self_contained:
                query = utterance
            else:
                query = " ".join([goal.text, *goal.constraints, utterance])

            await self.emit(StageFrame(stage=Stage.RETRIEVING, turn_id=turn_id, detail="Gathering evidence"))
            budget = self.harness.new_budget()
            evidence = carried_evidence
            if not evidence:
                evidence = await self._retrieve(query, budget, use_speculation=self_contained)
            else:
                await self.emit(
                    SpecFrame(
                        status="hit", query=utterance,
                        saved_ms=float(settings.retrieval_latency_ms),
                        docs=[e["doc_id"] for e in evidence],
                    )
                )
            self._evidence = evidence
            self._plan_progress = "evidence gathered"

            # -- 3b. irreversible actions go through the harness ---------
            notice: str | None = None
            if _ACTION_INTENT.search(utterance):
                await self.emit(
                    StageFrame(stage=Stage.TOOLING, turn_id=turn_id, detail="Requesting an irreversible action")
                )
                attempt = await self.harness.call(
                    "send_booking", budget, route=goal.text[:60], date="", passenger=""
                )
                await self.emit(
                    ToolFrame(
                        call_id=attempt.call_id, name=attempt.name, status=attempt.status,
                        verdict=attempt.verdict, args=attempt.args, latency_ms=attempt.latency_ms,
                    )
                )
                if attempt.status == "blocked":
                    notice = (
                        "I can't put that booking through myself - the harness blocks irreversible "
                        f"actions without a human confirming them. ({attempt.verdict}) "
                        "Here is everything you need to decide, then you can confirm it."
                    )

            # -- 4. plan ------------------------------------------------
            request = GenerationRequest(
                goal=goal.text,
                utterance=utterance,
                constraints=list(goal.constraints),
                context=self.session.context(),
                evidence=evidence,
                resume_from=resume_from,
                modality=modality,
                notice=notice,
            )
            await self.emit(StageFrame(stage=Stage.REASONING, turn_id=turn_id, detail="Drafting a plan"))
            for index, step in enumerate(self.provider.plan(request), start=1):
                await asyncio.sleep(settings.plan_step_ms / 1000.0)
                self._plan_progress = f"plan step {index}: {step}"
                await self.emit(StageFrame(stage=Stage.REASONING, turn_id=turn_id, detail=step))

            # -- 5. stream ----------------------------------------------
            await self.emit(StageFrame(stage=Stage.RESPONDING, turn_id=turn_id, detail="Answering - interrupt any time"))
            turn_started = now_ms()
            first_token_at: float | None = None
            async for chunk in self.provider.stream(request):
                if first_token_at is None:
                    first_token_at = now_ms()
                    await self.emit(
                        MetricFrame(
                            name="time_to_first_token",
                            value=round(first_token_at - turn_started, 1),
                            note="plan complete -> first visible word",
                        )
                    )
                self._partial_out += chunk
                await self.emit(TokenFrame(turn_id=turn_id, text=chunk))
            self._plan_progress = "answer complete"

            # -- 6. commit ----------------------------------------------
            full = (resume_from or "") + self._partial_out if resume_from else self._partial_out
            self.session.add_turn(
                Turn(turn_id, "agent", full, status="resumed" if resume_from else "complete")
            )
            await self.emit(
                MessageFrame(
                    turn_id=turn_id, role="agent", content=self._partial_out,
                    status="resumed" if resume_from else "complete",
                    meta={
                        "evidence": [e["doc_id"] for e in evidence],
                        "goal_id": goal.goal_id,
                        "tools": [
                            {"name": o.name, "status": o.status, "verdict": o.verdict}
                            for o in budget.audit
                        ],
                    },
                )
            )
            await self.emit(
                MetricFrame(
                    name="turn_duration", value=round(now_ms() - turn_started, 1),
                    note="first plan step -> final word",
                )
            )
            await self.emit(StageFrame(stage=Stage.IDLE, turn_id=turn_id, detail="Your move."))

        except asyncio.CancelledError:
            interrupted = True
            raise
        except Exception as exc:  # noqa: BLE001
            await self.emit(ErrorFrame(message=f"{type(exc).__name__}: {exc}"))
            await self.emit(StageFrame(stage=Stage.IDLE, detail="Recovered from an error."))
        finally:
            if interrupted:
                # Synchronous only. Unwinding a cancellation is no place to be
                # awaiting a websocket; interrupt() does the reporting.
                self.session.save_checkpoint(
                    turn_id=turn_id,
                    partial_text=self._partial_out,
                    evidence=self._evidence,
                    plan_progress=self._plan_progress,
                )

    # ------------------------------------------------------------------
    async def _retrieve(
        self, query: str, budget: TurnBudget, use_speculation: bool = True
    ) -> list[dict[str, str]]:
        """Settle speculation first; fall back to a cold retrieval on a miss."""
        if not use_speculation:
            self.speculation.cancel_all()
            await self.emit(
                SpecFrame(
                    status="discarded", query=query, saved_ms=0.0,
                )
            )
            return await self._cold_retrieve(query, budget)

        result = await self.speculation.settle(query)
        if result.hit:
            await self.emit(
                SpecFrame(
                    status="hit", query=result.query, saved_ms=result.saved_ms,
                    docs=[h.doc.doc_id for h in result.hits],
                )
            )
            await self.emit(
                MetricFrame(
                    name="speculation_saved", value=result.saved_ms,
                    note=f"retrieval had a head start: {result.field_note}",
                )
            )
            return _hits_to_evidence(result.hits)

        await self.emit(
            SpecFrame(status="miss", query=result.query or query, saved_ms=0.0)
        )
        return await self._cold_retrieve(query, budget)

    async def _cold_retrieve(self, query: str, budget: TurnBudget) -> list[dict[str, str]]:
        outcome = await self.harness.call(
            "search_corpus", budget, query=query, latency_ms=settings.retrieval_latency_ms
        )
        await self.emit(
            ToolFrame(
                call_id=outcome.call_id, name=outcome.name, status=outcome.status,
                verdict=outcome.verdict, args=outcome.args, latency_ms=outcome.latency_ms,
            )
        )
        if outcome.status != "ok" or not outcome.result:
            return []
        return [
            {"doc_id": r["doc_id"], "title": r["title"], "snippet": r["snippet"], "source": r["doc_id"].split("#")[0]}
            for r in outcome.result["results"]
        ]

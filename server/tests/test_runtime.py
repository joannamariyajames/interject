"""The behaviours the brief actually asks for, exercised end to end."""

from __future__ import annotations

import asyncio

from app.runtime import AgentRuntime
from app.schemas import GoalAction
from app.session import Session
from tests.collector import Collector


def make() -> tuple[AgentRuntime, Collector, Session]:
    collector = Collector()
    session = Session(session_id="test")
    return AgentRuntime(session, collector), collector, session


async def wait_for_tokens(collector: Collector, count: int, timeout: float = 6.0) -> None:
    deadline = asyncio.get_event_loop().time() + timeout
    while len(collector.of("token")) < count:
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError(f"only saw {len(collector.of('token'))} tokens")
        await asyncio.sleep(0.01)


async def test_a_complete_turn_streams_and_grounds_its_answer():
    runtime, collector, _ = make()
    await runtime.on_final("What are the baggage limits?")
    await runtime._task
    assert "responding" in collector.stages()
    assert collector.text().strip()
    message = collector.of("message")[-1]
    assert message["role"] == "agent"
    assert message["status"] == "complete"
    assert message["meta"]["evidence"], "the answer must cite retrieved passages"


async def test_barge_in_stops_mid_answer_and_keeps_the_work():
    runtime, collector, session = make()
    await runtime.on_final("What are the baggage limits on each cabin?")
    await wait_for_tokens(collector, 6)

    emitted_before = len(collector.of("token"))
    await runtime.interrupt("barge_in")

    assert not runtime.busy
    assert "interrupted" in collector.stages()

    # Nothing kept streaming after the interrupt was acknowledged.
    await asyncio.sleep(0.15)
    assert len(collector.of("token")) == emitted_before

    checkpoints = collector.of("checkpoint")
    assert checkpoints, "an interruption must leave a checkpoint behind"
    assert checkpoints[-1]["kept_tokens"] > 0
    assert session.interruptions == 1


async def test_time_to_yield_is_reported_and_fast():
    runtime, collector, _ = make()
    await runtime.on_final("Tell me about change and cancellation windows")
    await wait_for_tokens(collector, 5)
    await runtime.interrupt("barge_in")

    time_to_yield = collector.metric("time_to_yield")
    assert time_to_yield is not None
    # Generous bound for CI; locally this lands in single-digit milliseconds.
    assert time_to_yield < 250, f"agent took {time_to_yield} ms to yield"


async def test_continuing_after_an_interrupt_resumes_instead_of_restarting():
    runtime, collector, session = make()
    await runtime.on_final("What are the baggage limits on each cabin?")
    await wait_for_tokens(collector, 8)
    await runtime.interrupt("barge_in")
    kept = collector.of("checkpoint")[-1]["kept_tokens"]

    await runtime.on_final("go on")
    await runtime._task

    assert session.resumes == 1
    assert "recovering" in collector.stages()
    recovered = collector.metric("recovered_tokens")
    assert recovered == float(kept)
    assert "Picking up where I stopped" in collector.text()


async def test_a_goal_switch_after_an_interrupt_parks_instead_of_resuming():
    runtime, collector, session = make()
    await runtime.on_final("Find me a flight from Bengaluru to Mumbai on Friday")
    await wait_for_tokens(collector, 6)
    await runtime.interrupt("barge_in")

    await runtime.on_final("actually, what is the refund policy if I cancel?")
    await runtime._task

    decisions = [f for f in collector.of("goal") if f["action"] != GoalAction.PROGRESS.value]
    assert decisions[-1]["action"] == GoalAction.SWITCH.value
    assert session.resumes == 0, "a switch must not resume the old answer"
    statuses = [g["status"] for g in decisions[-1]["stack"]]
    assert "parked" in statuses, "the abandoned goal is kept for later"


async def test_a_new_utterance_while_streaming_is_itself_a_barge_in():
    runtime, collector, session = make()
    await runtime.on_final("What are the baggage limits on each cabin?")
    await wait_for_tokens(collector, 6)
    await runtime.on_final("what about the refund policy?")
    await runtime._task
    assert session.interruptions == 1
    assert "interrupted" in collector.stages()


async def test_speculative_retrieval_is_reused_when_the_guess_holds():
    runtime, collector, _ = make()
    await runtime.on_partial("what are the baggage limits")
    await asyncio.sleep(0.05)  # still "speaking"; retrieval is already running
    await runtime.on_final("what are the baggage limits on business class?")
    await runtime._task

    spec = collector.of("spec")
    assert any(f["status"] == "started" for f in spec)
    hits = [f for f in spec if f["status"] == "hit"]
    assert hits, "a matching partial should produce a speculation hit"
    assert hits[-1]["saved_ms"] > 0


async def test_speculation_miss_is_discarded_without_delaying_the_turn():
    runtime, collector, _ = make()
    await runtime.on_partial("what are the baggage limits on economy")
    await asyncio.sleep(0.03)
    await runtime.on_final("who do I call when my flight is delayed overnight?")
    await runtime._task
    assert any(f["status"] == "miss" for f in collector.of("spec"))
    assert collector.text().strip(), "the turn still produced an answer"


async def test_reset_clears_session_scoped_memory():
    runtime, collector, session = make()
    await runtime.on_final("Find me a flight to Mumbai")
    await runtime._task
    assert session.turns
    await runtime.reset()
    assert session.turns == []
    assert session.goals.stack == []


async def test_the_harness_blocks_a_booking_and_the_answer_says_so():
    """The refusal has to be a real audited event, not a claim in a README."""
    runtime, collector, _ = make()
    await runtime.on_final("just book the ticket for me now")
    await runtime._task

    blocked = [f for f in collector.of("tool") if f["status"] == "blocked"]
    assert blocked, "the agent must actually attempt the call and be refused"
    assert blocked[-1]["name"] == "send_booking"
    assert "confirmation" in blocked[-1]["verdict"]
    assert "can't put that booking through" in collector.text()


async def test_a_revert_retrieves_against_the_restored_goal_not_the_bare_words():
    """"anyway, back to the flight" carries no topic of its own.

    Retrieving on those words alone answered the previous question again,
    which is precisely the "losing the relevant session context" failure.
    """
    runtime, collector, _ = make()
    await runtime.on_final("Find me a flight from Bengaluru to Mumbai on Friday")
    await runtime._task
    await runtime.on_final("actually, what happens to my refund if I cancel?")
    await runtime._task

    before = len(collector.of("message"))
    await runtime.on_final("anyway, back to the flight")
    await runtime._task

    answer = collector.of("message")[-1]
    assert len(collector.of("message")) > before
    docs = answer["meta"]["evidence"]
    assert any(d.startswith("flights") for d in docs), f"answered off the wrong corpus: {docs}"
    assert docs[0].startswith("flights"), f"top passage should be about flights, got {docs}"


async def test_a_terse_refinement_keeps_the_goal_topic():
    runtime, collector, _ = make()
    await runtime.on_final("Which hotel should I book in Mumbai?")
    await runtime._task
    await runtime.on_final("make it under 9000 a night")
    await runtime._task

    docs = collector.of("message")[-1]["meta"]["evidence"]
    assert any(d.startswith("hotels") for d in docs), f"lost the hotel topic: {docs}"


async def test_filler_keeps_the_conversation_alive_before_the_answer():
    """The brief asks for the conversation to stay alive while the agent thinks."""
    runtime, collector, _ = make()
    await runtime.on_final("What are the baggage limits on each cabin?")
    await runtime._task

    filler = collector.of("filler")
    assert filler, "the agent went silent while it worked"

    # Filler must all land before the real answer starts, and must never become
    # part of the transcript.
    first_token = next(f for f in collector.frames if f["t"] == "token")
    assert all(f["ts"] <= first_token["ts"] for f in filler)
    answer = collector.of("message")[-1]["content"]
    assert not any(f["text"] in answer for f in filler)


async def test_filler_stops_the_instant_the_user_barges_in():
    runtime, collector, _ = make()
    await runtime.on_final("Find me a flight from Bengaluru to Mumbai on Friday")
    await asyncio.sleep(0.6)  # let at least one filler line land
    assert collector.of("filler")
    await runtime.interrupt("barge_in")

    seen = len(collector.of("filler"))
    await asyncio.sleep(1.6)  # longer than the filler gap
    assert len(collector.of("filler")) == seen, "filler kept talking after the interrupt"


async def test_plan_steps_report_progress_towards_the_goal():
    runtime, collector, _ = make()
    await runtime.on_final("What are the baggage limits on each cabin?")
    await runtime._task

    progress = [f for f in collector.of("goal") if f["action"] == "progress"]
    assert progress, "no progress reported"
    final_goal = progress[-1]["stack"][-1]
    assert final_goal["steps"], "the goal carries no plan"
    assert final_goal["progress"] == 1.0, "the plan never completed"


async def test_a_detour_offers_the_way_back_to_the_parked_goal():
    """"driving the conversation towards end goal" - the agent proposes it."""
    runtime, collector, _ = make()
    await runtime.on_final("Find me a flight from Bengaluru to Mumbai on Friday")
    await runtime._task
    assert not collector.of("nudge"), "nothing parked yet, so nothing to offer"

    await runtime.on_final("actually, what happens to my refund if I cancel?")
    await runtime._task

    nudges = collector.of("nudge")
    assert nudges, "the parked goal was never offered back"
    assert "flight" in nudges[-1]["text"].lower()


async def test_a_topic_free_prefix_never_wins_the_speculation():
    """The bug this guards against was visible in the demo.

    Speaking "actually wait what happens to my refund if I cancel this" fires a
    speculation on "actually wait what happens" - a prefix with no topic in it.
    Treating any prefix as a perfect match let that win, and the agent then
    answered that it had nothing on refunds while the corpus plainly did.
    """
    runtime, collector, _ = make()
    for prefix in ("actually wait", "actually wait what", "actually wait what happens"):
        await runtime.on_partial(prefix)
        await asyncio.sleep(0.03)
    await runtime.on_final("actually wait what happens to my refund if I cancel this")
    await runtime._task

    answer = collector.of("message")[-1]
    docs = answer["meta"]["evidence"]
    assert docs, "the agent found nothing despite the corpus covering refunds"
    assert any(d.startswith("policy") for d in docs), f"wrong passages: {docs}"
    assert "don't have anything in the corpus" not in collector.text()

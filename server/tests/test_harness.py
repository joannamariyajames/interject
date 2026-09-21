from __future__ import annotations

import asyncio

import pytest

from app.harness import Harness


async def test_irreversible_tool_cannot_be_self_authorised():
    harness = Harness(strict=True)
    budget = harness.new_budget()
    outcome = await harness.call("send_booking", budget, route="BLR-BOM", date="Friday")
    assert outcome.status == "blocked"
    assert "confirmation" in outcome.verdict


async def test_unknown_tool_is_refused():
    harness = Harness(strict=True)
    outcome = await harness.call("rm_rf", harness.new_budget(), path="/")
    assert outcome.status == "blocked"
    assert "Unknown tool" in outcome.verdict


async def test_budget_caps_calls_per_turn():
    harness = Harness(strict=True)
    budget = harness.new_budget()
    statuses = [
        (await harness.call("search_corpus", budget, query="baggage")).status
        for _ in range(budget.max_calls + 2)
    ]
    assert statuses[-1] == "blocked"
    assert budget.used == budget.max_calls


async def test_personal_arguments_are_redacted_in_the_audit():
    harness = Harness(strict=True)
    outcome = await harness.call("send_booking", harness.new_budget(), passenger="Joanna James")
    assert outcome.args["passenger"] == "[redacted]"


async def test_cancellation_propagates_rather_than_being_swallowed():
    """A barge-in has to be able to tear down an in-flight tool call."""
    harness = Harness(strict=False)
    budget = harness.new_budget()
    task = asyncio.ensure_future(
        harness.call("search_corpus", budget, query="baggage", latency_ms=5000)
    )
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert budget.audit[-1].verdict == "Cancelled by interrupt."

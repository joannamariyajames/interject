from __future__ import annotations

from app.goals import GoalTracker
from app.schemas import GoalAction


def run(utterances: list[str]) -> tuple[GoalTracker, list[GoalAction]]:
    tracker = GoalTracker()
    actions = []
    for text in utterances:
        classification = tracker.classify(text)
        tracker.apply(text, classification)
        actions.append(classification.action)
    return tracker, actions


def test_first_utterance_pushes_a_goal():
    tracker, actions = run(["Find me a flight to Mumbai on Friday"])
    assert actions == [GoalAction.PUSH]
    assert tracker.active is not None
    assert tracker.active.status.value == "active"


def test_terse_amendment_refines_instead_of_switching():
    """The regression that matters: 'make it under 6000' shares no nouns with
    the goal it amends, so a naive overlap rule reads it as a new goal."""
    tracker, actions = run(
        ["Find me a flight from Bengaluru to Mumbai on Friday", "make it under 6000 rupees"]
    )
    assert actions[1] is GoalAction.REFINE
    assert len(tracker.stack) == 1
    assert tracker.active is not None
    assert "under 6000" in tracker.active.constraints


def test_explicit_switch_parks_rather_than_drops_the_goal():
    tracker, actions = run(
        ["Find me a flight to Mumbai", "actually, what is the refund policy if I cancel?"]
    )
    assert actions[1] is GoalAction.SWITCH
    statuses = [g.status.value for g in tracker.stack]
    assert "parked" in statuses, "the original goal must survive the swerve"
    assert len(tracker.stack) == 2


def test_revert_resumes_the_parked_goal_with_its_constraints():
    tracker, actions = run(
        [
            "Find me a flight from Bengaluru to Mumbai on Friday",
            "make it under 6000 rupees",
            "actually, what is the refund policy if I cancel?",
            "anyway, back to the flight",
        ]
    )
    assert actions[3] is GoalAction.REVERT
    active = tracker.active
    assert active is not None
    assert "flight" in active.text.lower()
    assert "under 6000" in active.constraints, "constraints survive a detour"

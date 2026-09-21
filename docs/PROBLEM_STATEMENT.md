# Theme 05 - Interruptible Real-Time Agents

Samsung PRISM Y2026 GenAI Hackathon, 3rd Edition.

## Problem statement

AI assistants today take turns: listen, think, then speak. People interrupt,
change their mind mid-sentence and switch goals while a task is still running.
Most systems either go silent while they reason, or throw everything away and
start over. An assistant that stays responsive while it thinks, and recovers
cleanly when the plan changes, is an open problem.

## What to build

- Keep the user entertained and the conversation alive, without losing logical
  depth and core functionality.
- Handle and recover from real-time interruptions, while driving the
  conversation towards the end goal.
- Cater to different changes in goals without losing the relevant session
  context.
- Make a solid harness around the real-time agent to produce safe and reliable
  agentic structure.

## Scope and constraints

- Full duplex: begin retrieving before the utterance ends.
- Corpus provided; voice input may be simulated from transcripts.
- Session-scoped memory only - no cross-session user profile.
- Out of scope: speech synthesis quality, wake-word detection, UI polish.

## Tech focus

- Streaming and async agent designs.
- Optimizing for latency and interruptions without compromising reasoning depth
  and functions.
- Multi-modal inputs and multimodal outputs.

---

## Where each requirement is implemented

| Requirement | Code |
| --- | --- |
| Begin retrieving before the utterance ends | `server/app/speculation.py` |
| Handle and recover from interruptions | `server/app/runtime.py` (`interrupt`, `_run_turn`), `server/app/session.py` (`Checkpoint`) |
| Goal changes without losing session context | `server/app/goals.py` |
| Safe, reliable agentic harness | `server/app/harness.py`, `server/app/tools.py` |
| Session-scoped memory only | `server/app/session.py` (`SessionStore`) |
| Multi-modal inputs | `web/src/components/Composer.tsx`, `GenerationRequest.modality` |
| Latency instrumentation | `MetricFrame` in `server/app/schemas.py`, `web/src/components/MindRail.tsx` |

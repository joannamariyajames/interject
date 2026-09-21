# Interject

**An agent you are meant to talk over.**

Built for **Theme 05 - Interruptible Real-Time Agents**, Samsung PRISM Y2026 GenAI
Hackathon (3rd Edition).

[![CI](https://github.com/joannamariyajames/interject/actions/workflows/ci.yml/badge.svg)](https://github.com/joannamariyajames/interject/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)
![Node 20+](https://img.shields.io/badge/node-20+-5fa04e.svg)

Most assistants take turns: listen, think, speak. Interrupt one and it either
goes silent while it reasons, or throws the whole turn away and starts again.
Interject does neither. It starts retrieving before you stop typing, it stops
mid-word the instant you cut in, and it keeps what it had already worked out so
the next thing you say continues the answer instead of restarting it.

---

## What it does

| Brief says | What is actually implemented |
| --- | --- |
| Full duplex: begin retrieving before the utterance ends | Partial text streams to the server on every keystroke. A debounced speculative retrieval starts on the prefix, and the turn reuses it if the guess still matches when you hit enter. Hit/miss and milliseconds saved are shown live. |
| Handle and recover from real-time interruptions | A turn is one cancellable `asyncio.Task`. A barge-in cancels it and records a **checkpoint**: the partial answer, the retrieved passages, and how far the plan got. Measured time-to-yield is typically **under 1 ms**. |
| Keep the conversation alive without losing logical depth | The checkpoint is reused, not replayed. "go on" resumes from the exact words it stopped on and skips retrieval entirely. |
| Cater to goal changes without losing session context | A goal **stack**, not a variable. A swerve *parks* the old goal instead of dropping it, carrying its accumulated constraints, so "anyway, back to the flight" restores it intact. |
| A solid harness around the real-time agent | Admission control, per-turn tool budgets, hard timeouts, argument redaction, and cancellation that is re-raised rather than swallowed. Irreversible tools cannot be self-authorised. Every verdict is streamed to the UI. |
| Session-scoped memory only | An in-process store keyed by socket. No disk, no cross-session profile. Closing the tab ends it. |
| Multi-modal inputs | Text, voice (simulated from transcripts, as the brief permits) and image-accompanied questions. |

Out of scope per the brief, and deliberately not attempted: speech synthesis
quality, wake-word detection, UI polish as a graded artifact.

---

## Quick start

No API key needed. The default engine is deterministic and runs offline.

```bash
make setup
```

Then, in two terminals:

```bash
make api
```

```bash
make web
```

Open <http://localhost:5174>.

<details>
<summary>Without make</summary>

```bash
cd server && python3.11 -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt
./.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

```bash
cd web && npm install && npm run dev
```
</details>

### Try it in 30 seconds

1. Ask **"What are the baggage limits on each cabin?"**
2. While it is answering, press **Esc** - or just start typing. Both count as
   barging in. Watch *time to yield* in the right rail.
3. Say **"go on"**. It resumes from the checkpoint rather than starting over.
4. Now say **"actually, what happens to my refund if I cancel?"** - the goal
   stack parks the first goal instead of forgetting it.
5. Say **"anyway, back to the flight"** to bring it back, constraints intact.

The four buttons under **Scripted demos** in the sidebar replay each of these
against the live socket, using the same public actions a human would.

### Using a real model

Everything works the same; only the token source changes.

```bash
export LLM_API_KEY=sk-...
export LLM_BASE_URL=https://api.openai.com/v1   # or Groq, Together, vLLM, Ollama
export LLM_MODEL=gpt-4o-mini
```

Streaming stays cancellable chunk by chunk, so interruption behaves identically.

---

## How it works

```
browser ──partial text (every keystroke)──▶  speculative retrieval starts
        ──final utterance───────────────▶  goal classification
                                            └▶ checkpoint reuse decision
                                            └▶ retrieval (speculated or cold)
                                            └▶ harness-gated tool calls
                                            └▶ token stream ─────────────▶ browser
        ──interrupt─────────────────────▶  task.cancel() ──▶ checkpoint saved
```

Three design decisions carry most of the weight:

**The turn never emits from its own `finally`.** Cancellation unwinding is a bad
place to be awaiting a websocket. The cancelled task records its checkpoint
synchronously and dies; the socket reader - which was never cancelled - reports
the interruption. This is why time-to-yield is sub-millisecond and why an
interrupt can never deadlock against the turn it is stopping.

**Interruption is subtractive, not destructive.** The checkpoint holds the
partial text, the evidence and the plan position. What happens to it is decided
by the *next* utterance, not at interrupt time: continue it, refine it, or park
the whole goal. Nothing is discarded just because the user spoke.

**Speculation must never cost anything.** A miss cancels in-flight work
immediately and falls through to a normal retrieval. Speculation can only ever
remove latency from the critical path, never add it.

Full write-up: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Layout

```
server/          FastAPI + asyncio agent runtime
  app/runtime.py     the interruptible turn: cancellation, checkpoints, recovery
  app/goals.py       goal stack and the rules that reshape it
  app/speculation.py retrieve-before-you-finish-speaking
  app/harness.py     admission control, budgets, timeouts, redaction
  app/retrieval.py   dependency-free BM25 over the corpus
  app/providers/     deterministic local engine + OpenAI-compatible streaming
  corpus/            the provided corpus (travel: fares, hotels, policy, support)
  tests/             19 tests, including the interruption behaviours
web/             React + Vite + Tailwind v4
  src/components/MindRail.tsx    live stages, latency, harness audit, timeline
  src/components/Transcript.tsx  streaming, interrupted and resumed messages
  src/store/session.ts           socket frames -> UI state
```

## Tests

```bash
make test
```

The suite asserts the behaviours rather than the plumbing: that a barge-in stops
token emission, that time-to-yield stays under budget, that a continuation
resumes instead of restarting, that a goal switch parks rather than resumes,
that a speculation miss does not delay the turn, and that the harness actually
refuses an irreversible call.

## Known limits

- Goal classification is rule-based and inspectable by design. It is good on the
  patterns it knows and will mislabel an unusual phrasing; every decision ships
  its rationale to the UI so you can see when it does.
- BM25 over a 15-document corpus occasionally surfaces a loosely related passage.
  Answers cite their `doc_id`s so a wrong pull is visible rather than laundered.
- The telemetry rail is desktop-first: it is shown by default from 1280px and can
  be toggled on from 1024px. Below 768px the sidebar moves into a slide-over
  drawer behind the menu button. The chat itself works at phone width.





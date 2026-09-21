# Architecture

## The problem with turn-taking

A conventional assistant loop is `listen -> think -> speak`, and each arrow is a
barrier. Retrieval cannot start until the utterance ends. Speaking cannot start
until reasoning ends. And an interruption arriving anywhere in the middle has
nowhere useful to land, so implementations usually pick one of two bad options:
ignore it until the turn completes, or throw the turn away and start over.

Interject removes the barriers one at a time.

## 1. Full duplex input

The browser sends a `partial` frame on every keystroke. The server treats these
as a live, revisable utterance rather than as noise to be buffered.

`SpeculationManager` debounces them and starts a retrieval against the prefix
once there is enough signal (`SPEC_MIN_CHARS`, default 12) and a *new content
word* has appeared - keying on stemmed tokens rather than raw text, so typing
"limit" then "limits" does not spawn a second task.

When the final utterance arrives, `settle()` scores each in-flight speculation
against it. A prefix match scores 1.0; otherwise it is the fraction of the
final utterance's content words the guess already covered. Above
`SPEC_MATCH_THRESHOLD` (0.55) the winner is awaited and the losers cancelled; the
head start it had already accumulated is reported as `saved_ms`.

Below the threshold, every speculation is cancelled and the turn falls through
to a normal retrieval. This asymmetry is the point: **speculation can only
remove latency from the critical path, never add it.** A miss costs some wasted
CPU on a cancelled task and nothing else.

## 2. The interruptible turn

One turn is one `asyncio.Task`. Every expensive step inside it - the retrieval
sleep, each plan step, each emitted token - sits behind an `await`, so a
cancellation lands between two words rather than after the whole answer.

`interrupt()` runs on the socket reader task, which is never cancelled:

```python
started = now_ms()
task.cancel()
try:
    await task
except asyncio.CancelledError:
    pass
time_to_yield = now_ms() - started
```

### Why the turn never emits from its own `finally`

The obvious implementation puts the interruption reporting in the turn's own
cleanup. That is a trap. A cancelled coroutine's `finally` is a hostile place to
`await` a websocket: a second cancellation, a closed transport or a slow send
can all strand the unwinding, and the interrupt that was supposed to be
instantaneous ends up waiting on the turn it is trying to stop.

So the turn's `finally` is **synchronous only**. It records the checkpoint into
session state and dies. The socket reader - already awake, already holding the
send lock, and never cancelled - does the reporting. This is the single reason
time-to-yield is measured in fractions of a millisecond rather than tens.

### Checkpoints

A checkpoint is what the agent had achieved when it was cut off:

- the partial answer text, word for word
- the evidence it had already retrieved
- how far the plan had got (`plan step 3: Ground the answer in retrieved passages`)

Crucially, **nothing decides what to do with it at interrupt time.** The
checkpoint just sits there. The *next* utterance decides:

| Next utterance classifies as | What happens to the checkpoint |
| --- | --- |
| `continue` / `refine` | Resumed. Partial text is fed back as `resume_from`, evidence is reused, retrieval is skipped entirely. |
| `switch` | Parked with its goal. The answer is not resumed, but the session context that produced it survives. |
| `revert` | The parked goal - and its constraints - comes back to the top of the stack. |

This is what "recovers cleanly when the plan changes" means in practice: the
recovery strategy is chosen by what the user actually said next, not guessed at
the moment they interrupted.

## 3. The goal stack

A single mutable `current_goal` cannot represent "hold that thought". So goals
live on a stack, and a swerve pushes rather than overwrites.

Classification is rule-based and ordered, and the ordering is load-bearing:

1. **Revert markers** ("back to", "anyway", "where were we") - if anything is
   parked, resume it.
2. **Switch markers** ("actually", "forget that", "never mind") - park the
   active goal, push a new one.
3. **Continuation cues** ("go on", "keep going") in a short utterance.
4. **Terse amendments** - a short utterance (<= 7 content words) carrying a
   refine marker. This rule has to come before the overlap rule below, because
   *"make it under 6000 rupees"* shares **zero** content words with *"find me a
   flight from Bengaluru to Mumbai on Friday"*. A naive lexical-overlap
   classifier reads it as a brand new goal and silently drops the flight. This
   was a real bug during development; `test_terse_amendment_refines_instead_of_switching`
   exists to keep it dead.
5. **Lexical overlap** against the active goal: high means continue or refine,
   near-zero means a new goal.

Constraints are extracted separately (`under 6000`, `before 09:00`) and
accumulate on the goal they refine, so they survive a detour and come back with
it.

Every classification ships its rationale to the UI. When the rules get it wrong,
you can see exactly which one fired.

## 4. The harness

Four guarantees, each of which exists because of a specific failure mode in
real-time agents:

**Admission control.** Unknown tools and unexpected parameters are refused before
execution. Tools declaring `Effect.EXTERNAL` with `confirm=True` can never be
self-authorised - `send_booking` is structurally unreachable without a human.

**Per-turn budgets.** An interrupted-and-retried turn is the natural way to
amplify side effects: interrupt three times, get three bookings. A hard cap of
`MAX_TOOL_CALLS` per turn closes that.

**Timeouts.** Every call races `TOOL_TIMEOUT_MS`. One slow dependency pinning the
event loop would destroy the interruption latency the whole system promises.

**Cancellation safety.** `asyncio.CancelledError` is recorded in the audit and
then **re-raised**. A harness that swallows cancellation is a harness that makes
barge-in impossible - the tool call would survive the interrupt that was meant to
kill it.

Arguments are redacted (`passenger`, `email`, `card`, ...) before they go on the
wire. Every verdict, including the refusals, is streamed to the UI: the harness
is a visible part of the demo, not a silent wrapper.

## 5. Memory

An in-process dict keyed by a socket-issued session id. No disk, no cross-session
profile, swept on a TTL, dropped when the socket closes. The brief asks for
session-scoped memory only, and the simplest way to guarantee that is to have
nowhere else to put anything.

## Wire protocol

Client frames: `partial`, `final`, `interrupt`, `resume`, `reset`, `config`.

Server frames: `stage`, `token`, `message`, `goal`, `spec`, `tool`, `checkpoint`,
`metric`, `error` - each carrying a monotonic `ts`, so the UI timeline is
measured rather than inferred.

`interrupt` is dispatched before any other frame type in the socket reader's
branch order, so a barge-in is never queued behind the turn it is interrupting.

## Measured behaviour

| Metric | Meaning | Typical |
| --- | --- | --- |
| `time_to_yield` | Interrupt read -> turn fully stopped | < 1 ms |
| `time_to_first_token` | Plan complete -> first visible word | ~25 ms |
| `speculation_saved` | Retrieval latency removed by an early start | up to 260 ms |
| `recovered_tokens` | Words carried across an interruption instead of regenerated | varies |

All four are streamed live to the right-hand rail.

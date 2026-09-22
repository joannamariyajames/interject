import { create } from "zustand";
import { AgentSocket } from "~/lib/socket";
import type {
  ChatMessage,
  CheckpointRecord,
  Goal,
  GoalAction,
  MetricRecord,
  Modality,
  ServerFrame,
  SpecRecord,
  Nudge,
  Scenario,
  Stage,
  TimelineEvent,
  ToolRecord,
} from "~/lib/types";

const TIMELINE_CAP = 120;
const METRIC_CAP = 60;

let socket: AgentSocket | null = null;
let eventSeq = 0;
let scenarioCancelled = false;

const sleep = (msValue: number) => new Promise((resolve) => setTimeout(resolve, msValue));

function event(
  kind: TimelineEvent["kind"],
  label: string,
  detail: string,
  tone: TimelineEvent["tone"] = "neutral",
): TimelineEvent {
  return { id: `e${eventSeq++}`, kind, label, detail, tone, at: Date.now() };
}

function capped<T>(list: T[], next: T, cap: number) {
  const out = [...list, next];
  return out.length > cap ? out.slice(out.length - cap) : out;
}

const STAGE_TONE: Record<Stage, TimelineEvent["tone"]> = {
  idle: "neutral",
  listening: "info",
  speculating: "info",
  planning: "info",
  retrieving: "info",
  tooling: "info",
  reasoning: "info",
  responding: "live",
  interrupted: "accent",
  recovering: "warn",
  done: "neutral",
};

export interface SessionState {
  status: "connecting" | "open" | "closed";
  sessionId: string | null;
  provider: string;

  stage: Stage;
  stageDetail: string;

  messages: ChatMessage[];
  streaming: { turnId: string; text: string } | null;
  tokensThisTurn: number;
  filler: string | null;
  nudge: Nudge | null;

  goals: Goal[];
  goalAction: GoalAction | null;
  goalRationale: string;

  specs: SpecRecord[];
  tools: ToolRecord[];
  metrics: MetricRecord[];
  timeline: TimelineEvent[];
  checkpoint: CheckpointRecord | null;

  interruptions: number;
  resumes: number;
  lastError: string | null;
  startedAt: number;
  totalTokens: number;

  scenarios: Scenario[];
  runningScenario: string | null;

  draft: string;
  modality: Modality;
  strictHarness: boolean;
  tokenDelayMs: number;
  speculationOn: boolean;

  connect: () => void;
  disconnect: () => void;
  loadScenarios: () => void;
  runScenario: (scenario: Scenario) => Promise<void>;
  stopScenario: () => void;
  setDraft: (value: string) => void;
  setModality: (value: Modality) => void;
  submit: (text?: string) => void;
  interrupt: (reason?: "barge_in" | "stop") => void;
  resume: () => void;
  reset: () => void;
  setStrictHarness: (value: boolean) => void;
  setTokenDelay: (value: number) => void;
}

export const useSession = create<SessionState>((set, get) => ({
  status: "connecting",
  sessionId: null,
  provider: "-",

  stage: "idle",
  stageDetail: "Connecting...",

  messages: [],
  streaming: null,
  tokensThisTurn: 0,
  filler: null,
  nudge: null,

  goals: [],
  goalAction: null,
  goalRationale: "",

  specs: [],
  tools: [],
  metrics: [],
  timeline: [],
  checkpoint: null,

  interruptions: 0,
  resumes: 0,
  lastError: null,
  startedAt: Date.now(),
  totalTokens: 0,

  scenarios: [],
  runningScenario: null,

  draft: "",
  modality: "text",
  strictHarness: true,
  tokenDelayMs: 22,
  speculationOn: true,

  connect: () => {
    if (socket) return;
    socket = new AgentSocket(
      (frame) => applyFrame(set, get, frame),
      (status) => set({ status }),
    );
    socket.connect();
  },

  disconnect: () => {
    socket?.close();
    socket = null;
  },

  loadScenarios: () => {
    if (get().scenarios.length) return;
    fetch("/api/scenarios")
      .then((response) => response.json())
      .then((data) => set({ scenarios: data.scenarios ?? [] }))
      .catch(() => {
        /* the demo still works by hand without the scripted list */
      });
  },

  runScenario: async (scenario) => {
    scenarioCancelled = false;
    set({ runningScenario: scenario.id });

    const waitForIdle = async (budgetMs: number) => {
      const deadline = Date.now() + budgetMs;
      // Give the server a beat to leave idle before deciding it already landed.
      await sleep(250);
      while (get().stage !== "idle" && Date.now() < deadline) {
        if (scenarioCancelled) return;
        await sleep(60);
      }
    };

    for (const step of scenario.steps) {
      if (scenarioCancelled) break;

      if (step.kind === "say" && step.text) {
        get().submit(step.text);
        await sleep(400);
      } else if (step.kind === "interrupt") {
        get().interrupt("barge_in");
        await sleep(500);
      } else if (step.kind === "wait_idle") {
        await waitForIdle(15000);
        await sleep(350);
      } else if (step.kind === "wait_tokens") {
        const target = step.count ?? 10;
        const deadline = Date.now() + 8000;
        while (get().tokensThisTurn < target && Date.now() < deadline) {
          if (scenarioCancelled) break;
          await sleep(40);
        }
      }
    }

    await waitForIdle(12000);
    set({ runningScenario: null });
  },

  stopScenario: () => {
    scenarioCancelled = true;
    set({ runningScenario: null });
  },

  setDraft: (value) => {
    set({ draft: value });
    // Full duplex: the server starts retrieving on this, mid-utterance.
    socket?.send({ t: "partial", text: value, seq: value.length });
  },

  setModality: (value) => set({ modality: value }),

  submit: (text) => {
    const body = (text ?? get().draft).trim();
    if (!body) return;
    socket?.send({ t: "final", text: body, seq: 0, modality: get().modality });
    set({ draft: "", tokensThisTurn: 0, filler: null, nudge: null });
  },

  interrupt: (reason = "barge_in") => {
    socket?.send({ t: "interrupt", reason });
  },

  resume: () => socket?.send({ t: "resume" }),

  reset: () => {
    socket?.send({ t: "reset" });
    set({
      messages: [],
      streaming: null,
      goals: [],
      goalAction: null,
      goalRationale: "",
      specs: [],
      tools: [],
      metrics: [],
      timeline: [event("stage", "session", "Session memory cleared.", "neutral")],
      checkpoint: null,
      filler: null,
      nudge: null,
      interruptions: 0,
      resumes: 0,
      lastError: null,
      tokensThisTurn: 0,
      totalTokens: 0,
      startedAt: Date.now(),
    });
  },

  setStrictHarness: (value) => {
    set({ strictHarness: value });
    socket?.send({ t: "config", strict_harness: value });
  },

  setTokenDelay: (value) => {
    set({ tokenDelayMs: value });
    socket?.send({ t: "config", token_delay_ms: value });
  },
}));

type Setter = (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void;

function applyFrame(set: Setter, get: () => SessionState, frame: ServerFrame) {
  switch (frame.t) {
    case "ready":
      set({
        sessionId: frame.session_id,
        provider: frame.provider,
        speculationOn: frame.speculation,
        tokenDelayMs: frame.token_delay_ms,
      });
      break;

    case "stage":
      set((s) => ({
        stage: frame.stage,
        stageDetail: frame.detail,
        timeline:
          frame.detail && frame.detail !== "pong"
            ? capped(s.timeline, event("stage", frame.stage, frame.detail, STAGE_TONE[frame.stage]), TIMELINE_CAP)
            : s.timeline,
      }));
      break;

    case "token":
      set((s) => ({
        streaming: {
          turnId: frame.turn_id,
          text: (s.streaming?.turnId === frame.turn_id ? s.streaming.text : "") + frame.text,
        },
        tokensThisTurn: s.streaming?.turnId === frame.turn_id ? s.tokensThisTurn + 1 : 1,
        totalTokens: s.totalTokens + 1,
        filler: null,
      }));
      break;

    case "message": {
      const message: ChatMessage = {
        turnId: frame.turn_id,
        role: frame.role,
        content: frame.content,
        status: frame.status,
        modality: (frame.modality as Modality) ?? "text",
        meta: frame.meta,
        at: Date.now(),
      };
      set((s) => ({
        // The streamed buffer is replaced by the authoritative message.
        messages: [...s.messages.filter((m) => !(m.turnId === message.turnId && m.role === message.role)), message],
        streaming: frame.role === "agent" ? null : s.streaming,
        filler: frame.role === "agent" ? null : s.filler,
        interruptions: frame.status === "interrupted" ? s.interruptions + 1 : s.interruptions,
        resumes: frame.status === "resumed" ? s.resumes + 1 : s.resumes,
        // The server pops the checkpoint when a turn consumes it, so the card
        // must not linger here offering to resume something already resumed.
        checkpoint:
          frame.role === "agent" && frame.status !== "interrupted" ? null : s.checkpoint,
      }));
      break;
    }

    case "filler":
      // Ephemeral by design: only the latest line is held, and it never joins
      // the transcript.
      set({ filler: frame.text });
      break;

    case "nudge":
      set((s) => ({
        nudge: { goalId: frame.goal_id, text: frame.text, prompt: frame.prompt },
        timeline: capped(
          s.timeline,
          event("goal", "offered a way back", frame.text, "warn"),
          TIMELINE_CAP,
        ),
      }));
      break;

    case "goal":
      set((s) => ({
        goals: frame.stack,
        goalAction: frame.action,
        goalRationale: frame.rationale,
        timeline: capped(
          s.timeline,
          event("goal", frame.action, frame.rationale, frame.action === "switch" ? "accent" : "info"),
          TIMELINE_CAP,
        ),
      }));
      break;

    case "spec": {
      const record: SpecRecord = {
        status: frame.status,
        query: frame.query,
        savedMs: frame.saved_ms,
        docs: frame.docs ?? [],
        at: Date.now(),
      };
      set((s) => ({
        specs: capped(s.specs, record, 40),
        timeline: capped(
          s.timeline,
          event(
            "spec",
            `speculation ${frame.status}`,
            frame.status === "hit"
              ? `Reused an early retrieval, saved ${frame.saved_ms.toFixed(0)} ms`
              : frame.query || "no query",
            frame.status === "hit" ? "live" : "neutral",
          ),
          TIMELINE_CAP,
        ),
      }));
      break;
    }

    case "tool": {
      const record: ToolRecord = {
        callId: frame.call_id,
        name: frame.name,
        status: frame.status,
        verdict: frame.verdict,
        args: frame.args,
        latencyMs: frame.latency_ms,
        at: Date.now(),
      };
      set((s) => ({
        tools: capped(s.tools, record, 40),
        timeline: capped(
          s.timeline,
          event("tool", `${frame.name} ${frame.status}`, frame.verdict, frame.status === "blocked" ? "warn" : "info"),
          TIMELINE_CAP,
        ),
      }));
      break;
    }

    case "checkpoint":
      set((s) => ({
        checkpoint: {
          checkpointId: frame.checkpoint_id,
          turnId: frame.turn_id,
          summary: frame.summary,
          keptTokens: frame.kept_tokens,
          retrievedDocs: frame.retrieved_docs,
          planProgress: frame.plan_progress,
        },
        timeline: capped(s.timeline, event("checkpoint", "checkpoint saved", frame.summary, "accent"), TIMELINE_CAP),
      }));
      break;

    case "metric": {
      const record: MetricRecord = {
        name: frame.name,
        value: frame.value,
        unit: frame.unit,
        note: frame.note,
        at: Date.now(),
      };
      set((s) => ({
        metrics: capped(s.metrics, record, METRIC_CAP),
        timeline: capped(
          s.timeline,
          event("metric", frame.name, `${frame.value} ${frame.unit} - ${frame.note}`, "info"),
          TIMELINE_CAP,
        ),
      }));
      break;
    }

    case "error":
      set((s) => ({
        lastError: frame.message,
        timeline: capped(s.timeline, event("error", "error", frame.message, "warn"), TIMELINE_CAP),
      }));
      break;
  }
  void get;
}

/** Latest value for a metric name, or null if it has not fired yet. */
export function latestMetric(metrics: MetricRecord[], name: string) {
  for (let i = metrics.length - 1; i >= 0; i -= 1) {
    if (metrics[i].name === name) return metrics[i];
  }
  return null;
}

export function metricAverage(metrics: MetricRecord[], name: string) {
  const values = metrics.filter((m) => m.name === name).map((m) => m.value);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function totalSaved(metrics: MetricRecord[]) {
  return metrics.filter((m) => m.name === "speculation_saved").reduce((a, b) => a + b.value, 0);
}

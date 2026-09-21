export type Stage =
  | "idle"
  | "listening"
  | "speculating"
  | "planning"
  | "retrieving"
  | "tooling"
  | "reasoning"
  | "responding"
  | "interrupted"
  | "recovering"
  | "done";

export type GoalAction =
  | "push"
  | "continue"
  | "refine"
  | "switch"
  | "revert"
  | "complete";

export type Modality = "text" | "voice" | "image";

export interface Goal {
  goal_id: string;
  text: string;
  status: "active" | "parked" | "done";
  constraints: string[];
  turns: number;
}

export interface ChatMessage {
  turnId: string;
  role: "user" | "agent" | "system";
  content: string;
  status: "complete" | "interrupted" | "resumed" | "streaming";
  modality: Modality;
  meta?: Record<string, unknown>;
  at: number;
}

export interface ToolRecord {
  callId: string;
  name: string;
  status: "requested" | "allowed" | "blocked" | "ok" | "error" | "timeout";
  verdict: string;
  args: Record<string, unknown>;
  latencyMs: number;
  at: number;
}

export interface SpecRecord {
  status: "started" | "hit" | "miss" | "discarded";
  query: string;
  savedMs: number;
  docs: string[];
  at: number;
}

export interface MetricRecord {
  name: string;
  value: number;
  unit: string;
  note: string;
  at: number;
}

export interface CheckpointRecord {
  checkpointId: string;
  turnId: string;
  summary: string;
  keptTokens: number;
  retrievedDocs: string[];
  planProgress: string;
}

export interface TimelineEvent {
  id: string;
  kind: "stage" | "spec" | "tool" | "goal" | "checkpoint" | "metric" | "error";
  label: string;
  detail: string;
  at: number;
  tone: "neutral" | "live" | "accent" | "warn" | "info";
}

export interface ScenarioStep {
  kind: "say" | "interrupt" | "wait_tokens" | "wait_idle";
  text?: string;
  count?: number;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  steps: ScenarioStep[];
}

/** Frames the server sends. Mirrors `server/app/schemas.py`. */
export type ServerFrame =
  | { t: "ready"; session_id: string; provider: string; speculation: boolean; token_delay_ms: number }
  | { t: "stage"; ts: number; stage: Stage; detail: string; turn_id: string | null }
  | { t: "token"; ts: number; turn_id: string; text: string }
  | {
      t: "message";
      ts: number;
      turn_id: string;
      role: "user" | "agent" | "system";
      content: string;
      modality: string;
      status: "complete" | "interrupted" | "resumed";
      meta: Record<string, unknown>;
    }
  | { t: "goal"; ts: number; action: GoalAction; stack: Goal[]; rationale: string }
  | {
      t: "spec";
      ts: number;
      status: "started" | "hit" | "miss" | "discarded";
      query: string;
      saved_ms: number;
      docs: string[];
    }
  | {
      t: "tool";
      ts: number;
      call_id: string;
      name: string;
      status: ToolRecord["status"];
      verdict: string;
      args: Record<string, unknown>;
      latency_ms: number;
    }
  | {
      t: "checkpoint";
      ts: number;
      checkpoint_id: string;
      turn_id: string;
      summary: string;
      kept_tokens: number;
      retrieved_docs: string[];
      plan_progress: string;
    }
  | { t: "metric"; ts: number; name: string; value: number; unit: string; note: string }
  | { t: "error"; ts: number; message: string; recoverable: boolean };

export type ClientFrame =
  | { t: "hello"; session_id?: string }
  | { t: "partial"; text: string; seq: number }
  | { t: "final"; text: string; seq: number; modality: Modality; attachment?: string }
  | { t: "interrupt"; reason: "barge_in" | "stop" }
  | { t: "resume" }
  | { t: "reset" }
  | { t: "config"; token_delay_ms?: number; strict_harness?: boolean };

import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  History,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react";
import { Badge, Button, Panel, SectionLabel } from "~/components/ui/primitives";
import { StatCard } from "~/components/ui/stat";
import { StagePipeline } from "~/components/StagePipeline";
import { latestMetric, metricAverage, totalSaved, useSession } from "~/store/session";
import { cn } from "~/lib/utils";
import type { TimelineEvent } from "~/lib/types";

const BUCKET_MS = 5000;
const BUCKETS = 36;

const TONE_DOT: Record<TimelineEvent["tone"], string> = {
  neutral: "bg-muted",
  live: "bg-live",
  accent: "bg-accent",
  warn: "bg-warn",
  info: "bg-info",
};

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" });
}

/**
 * Session activity, five seconds per cell.
 *
 * Same shape as a contribution graph, but every cell is real: it counts the
 * frames the agent actually emitted in that window, so a burst of streaming
 * and a quiet stretch waiting for the user look different.
 */
function ActivityGrid() {
  const timeline = useSession((s) => s.timeline);
  const startedAt = useSession((s) => s.startedAt);

  const { cells, peak } = useMemo(() => {
    const counts = new Array(BUCKETS).fill(0);
    for (const entry of timeline) {
      const index = Math.floor((entry.at - startedAt) / BUCKET_MS);
      if (index >= 0 && index < BUCKETS) counts[index] += 1;
    }
    return { cells: counts, peak: Math.max(1, ...counts) };
  }, [timeline, startedAt]);

  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-1.5 px-0">
          <Activity size={12} /> Activity
        </SectionLabel>
        <span className="text-[10px] text-muted">5s per cell</span>
      </div>
      <div className="grid grid-cols-12 gap-1" role="img" aria-label="Agent activity over the session">
        {cells.map((count, index) => (
          <div
            key={index}
            title={`${index * 5}-${index * 5 + 5}s - ${count} event${count === 1 ? "" : "s"}`}
            className="aspect-square rounded-[4px] transition-colors duration-300"
            style={{
              background:
                count === 0
                  ? "var(--heat-0)"
                  : `color-mix(in oklab, var(--fill-teal) ${25 + Math.ceil((count / peak) * 3) * 25}%, var(--heat-0))`,
            }}
          />
        ))}
      </div>
    </section>
  );
}

/** One bar per interruption this session. */
function YieldChart() {
  const metrics = useSession((s) => s.metrics);
  const yields = useMemo(
    () => metrics.filter((m) => m.name === "time_to_yield").map((m) => m.value),
    [metrics],
  );

  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-1.5 px-0">
          <Timer size={12} /> Time to yield
        </SectionLabel>
        {yields.length ? (
          <span className="font-mono text-[10px] text-muted">
            peak {Math.max(...yields).toFixed(1)} ms
          </span>
        ) : null}
      </div>
      {yields.length ? (
        <div className="flex h-16 items-end gap-1 rounded-[var(--radius-item)] bg-surface p-2">
          {yields.slice(-24).map((value, index) => (
            <div
              key={index}
              title={`interruption ${index + 1}: ${value.toFixed(2)} ms`}
              style={{ height: `${Math.max((value / Math.max(...yields)) * 100, 8)}%` }}
              className="w-full max-w-[20px] min-w-[4px] flex-1 rounded-[3px] bg-accent/85 transition-all duration-300 hover:bg-accent"
            />
          ))}
        </div>
      ) : (
        <p className="rounded-[var(--radius-item)] border border-dashed border-line px-3 py-3 text-center text-[11px] text-muted">
          Interrupt the agent to record one.
        </p>
      )}
    </section>
  );
}

export function MindRail() {
  const {
    stage,
    stageDetail,
    metrics,
    timeline,
    tools,
    specs,
    checkpoint,
    interruptions,
    resumes,
    totalTokens,
    messages,
    resume,
  } = useSession();

  const avgYield = metricAverage(metrics, "time_to_yield");
  const ttft = latestMetric(metrics, "time_to_first_token");
  const saved = totalSaved(metrics);
  const skipped = metrics
    .filter((m) => m.name === "retrieval_skipped")
    .reduce((a, b) => a + b.value, 0);

  const settled = specs.filter((s) => s.status === "hit" || s.status === "miss");
  const hits = specs.filter((s) => s.status === "hit").length;
  const hitRate = settled.length ? Math.round((hits / settled.length) * 100) : null;
  const turns = messages.filter((m) => m.role === "user").length;
  const blocked = tools.filter((t) => t.status === "blocked");

  return (
    <Panel className="w-[360px] shrink-0 overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <Activity size={15} className="text-accent" />
        <h2 className="text-sm font-semibold tracking-tight">Agent mind</h2>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-live pulse-live" />
          live
        </span>
      </header>

      <div className="scrollable flex min-h-0 flex-1 flex-col gap-5 p-4">
        <div className="shrink-0">
          <StagePipeline stage={stage} detail={stageDetail} />
        </div>

        {/* Headline numbers, asymmetric on purpose so the eye has a path. */}
        <section className="grid shrink-0 grid-cols-2 gap-2">
          <StatCard
            wide
            fill="accent"
            label="Average time to yield"
            value={avgYield === null ? "--" : avgYield.toFixed(2)}
            unit="ms"
            hint={`${interruptions} interruption${interruptions === 1 ? "" : "s"} handled - ${resumes} recovered`}
          />
          <StatCard
            fill="teal"
            label="Latency removed"
            value={(saved + skipped).toFixed(0)}
            unit="ms"
            hint={hitRate === null ? "speculation + checkpoints" : `${hitRate}% of guesses reused`}
          />
          <StatCard
            fill="blue"
            label="Tokens streamed"
            value={totalTokens.toLocaleString()}
            hint={`${turns} turn${turns === 1 ? "" : "s"}`}
          />
          <StatCard
            fill="violet"
            label="First token"
            value={ttft ? ttft.value.toFixed(0) : "--"}
            unit="ms"
            hint="plan done to first word"
          />
          <StatCard
            fill="amber"
            label="Turns recovered"
            value={`${resumes}`}
            hint="resumed from a checkpoint"
          />
        </section>

        <ActivityGrid />
        <YieldChart />

        <AnimatePresence initial={false}>
          {checkpoint ? (
            <motion.section
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="shrink-0 cut-stripe rounded-[var(--radius-card)] bg-accent-soft/50 p-3"
            >
              <div className="flex items-center gap-1.5">
                <RotateCcw size={13} className="text-accent" />
                <SectionLabel className="px-0 text-accent">Checkpoint held</SectionLabel>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-foreground">{checkpoint.summary}</p>
              <p className="mt-1 text-[11px] text-muted">Stopped at: {checkpoint.planProgress}</p>
              <Button size="sm" variant="primary" className="mt-2.5 w-full" onClick={resume}>
                Resume from here
              </Button>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {specs.length ? (
          <section className="flex shrink-0 flex-col gap-2">
            <SectionLabel className="flex items-center gap-1.5 px-0">
              <Zap size={12} /> Speculative retrieval
            </SectionLabel>
            <div className="flex flex-col gap-1">
              {specs.slice(-3).reverse().map((spec, index) => (
                <div
                  key={`${spec.at}-${index}`}
                  className="spine flex items-center gap-2 py-1"
                  style={{
                    ["--spine-color" as string]:
                      spec.status === "hit" ? "var(--fill-teal)" : "var(--line)",
                  }}
                >
                  <Badge tone={spec.status === "hit" ? "live" : "neutral"} className="font-mono">
                    {spec.status}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={spec.query}>
                    {spec.query || "-"}
                  </span>
                  {spec.savedMs > 0 ? (
                    <span className="font-mono text-[11px] font-semibold text-live">
                      -{spec.savedMs.toFixed(0)}ms
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex shrink-0 flex-col gap-2">
          <SectionLabel className="flex items-center gap-1.5 px-0">
            {blocked.length ? <ShieldAlert size={12} className="text-warn" /> : <ShieldCheck size={12} />}
            Harness audit
          </SectionLabel>
          {tools.length === 0 ? (
            <p className="text-[11px] text-muted">
              No tool calls yet. Every call is admitted, budgeted and timed before it runs.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {tools.slice(-4).reverse().map((tool) => (
                <div
                  key={tool.callId}
                  className="spine py-1"
                  style={{
                    ["--spine-color" as string]:
                      tool.status === "blocked" ? "var(--warn)" : "var(--fill-teal)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-foreground">{tool.name}</span>
                    <Badge tone={tool.status === "ok" ? "live" : tool.status === "blocked" ? "warn" : "neutral"}>
                      {tool.status}
                    </Badge>
                    <span className="ml-auto font-mono text-[10px] text-muted">
                      {tool.latencyMs.toFixed(0)}ms
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{tool.verdict}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex shrink-0 flex-col gap-2">
          <SectionLabel className="flex items-center gap-1.5 px-0">
            <History size={12} /> Event timeline
          </SectionLabel>
          <div className="relative flex flex-col pl-3">
            <span className="absolute left-[3px] top-1 bottom-1 w-px bg-line" aria-hidden />
            {timeline.length === 0 ? (
              <p className="text-[11px] text-muted">Waiting for the first turn.</p>
            ) : null}
            {timeline.slice(-16).reverse().map((entry) => (
              <div key={entry.id} className="relative py-1.5">
                <span
                  className={cn(
                    "absolute -left-3 top-2.5 h-[7px] w-[7px] rounded-full ring-2 ring-panel",
                    TONE_DOT[entry.tone],
                  )}
                />
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] font-semibold text-foreground">{entry.label}</span>
                  <span className="font-mono text-[10px] text-muted">{time(entry.at)}</span>
                </div>
                <p className="text-[11px] leading-snug text-muted">{entry.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="shrink-0 rounded-[var(--radius-item)] bg-subtle px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          Every number here is measured from this session. Memory is session-scoped only: closing
          the tab ends it and the server drops what it held.
        </p>
      </div>
    </Panel>
  );
}

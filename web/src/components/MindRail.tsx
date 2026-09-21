import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  BookOpen,
  Gauge,
  History,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Badge, Button, Panel, SectionLabel, StatTile } from "~/components/ui/primitives";
import { StagePipeline } from "~/components/StagePipeline";
import { latestMetric, metricAverage, totalSaved, useSession } from "~/store/session";
import { cn, ms } from "~/lib/utils";
import type { TimelineEvent } from "~/lib/types";

const TONE_DOT: Record<TimelineEvent["tone"], string> = {
  neutral: "bg-muted",
  live: "bg-live",
  accent: "bg-accent",
  warn: "bg-warn",
  info: "bg-info",
};

function time(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });
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
    resume,
  } = useSession();

  const yieldMetric = latestMetric(metrics, "time_to_yield");
  const avgYield = metricAverage(metrics, "time_to_yield");
  const ttft = latestMetric(metrics, "time_to_first_token");
  const saved = totalSaved(metrics);

  const specHits = useMemo(() => specs.filter((s) => s.status === "hit").length, [specs]);
  const specTries = useMemo(
    () => specs.filter((s) => s.status === "hit" || s.status === "miss").length,
    [specs],
  );

  const blocked = tools.filter((t) => t.status === "blocked");

  return (
    <Panel className="w-[360px] shrink-0 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Activity size={15} className="text-accent" />
        <h2 className="text-sm font-semibold">Agent mind</h2>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted">live</span>
      </header>

      <div className="scrollable flex min-h-0 flex-1 flex-col gap-5 p-4">
        <div className="shrink-0">
          <StagePipeline stage={stage} detail={stageDetail} />
        </div>

        {/* ---------------------------------------------------- metrics */}
        <section className="flex shrink-0 flex-col gap-2">
          <SectionLabel className="flex items-center gap-1.5">
            <Gauge size={12} /> Latency
          </SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Time to yield"
              value={ms(yieldMetric?.value, 1)}
              hint={avgYield !== null ? `avg ${avgYield.toFixed(1)} ms over ${interruptions}` : "interrupt to measure"}
              tone="accent"
            />
            <StatTile
              label="First token"
              value={ms(ttft?.value)}
              hint="plan done to first word"
              tone="live"
            />
            <StatTile
              label="Saved by speculation"
              value={ms(saved)}
              hint={specTries ? `${specHits}/${specTries} guesses reused` : "starts before you finish"}
              tone="info"
            />
            <StatTile
              label="Recovered"
              value={`${resumes}`}
              hint={`${interruptions} interruption${interruptions === 1 ? "" : "s"} handled`}
              tone="warn"
            />
          </div>
        </section>

        {/* ------------------------------------------------- checkpoint */}
        <AnimatePresence initial={false}>
          {checkpoint ? (
            <motion.section
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="shrink-0 rounded-[var(--radius-card)] border border-accent/45 bg-accent-soft/40 p-3"
            >
              <div className="flex items-center gap-1.5">
                <RotateCcw size={13} className="text-accent" />
                <SectionLabel className="px-0 text-accent">Checkpoint held</SectionLabel>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-foreground">{checkpoint.summary}</p>
              <p className="mt-1 text-[11px] text-muted">Stopped at: {checkpoint.planProgress}</p>
              {checkpoint.retrievedDocs.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {checkpoint.retrievedDocs.map((doc) => (
                    <Badge key={doc} tone="accent" className="font-mono">
                      {doc}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <Button size="sm" variant="primary" className="mt-2.5 w-full" onClick={resume}>
                Resume from here
              </Button>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {/* ------------------------------------------------ speculation */}
        {specs.length ? (
          <section className="flex shrink-0 flex-col gap-2">
            <SectionLabel className="flex items-center gap-1.5">
              <Zap size={12} /> Speculative retrieval
            </SectionLabel>
            <div className="flex flex-col gap-1">
              {specs.slice(-4).reverse().map((spec, index) => (
                <div
                  key={`${spec.at}-${index}`}
                  className="flex items-center gap-2 rounded-[var(--radius-item)] border border-line bg-surface px-2.5 py-1.5"
                >
                  <Badge
                    tone={spec.status === "hit" ? "live" : spec.status === "miss" ? "neutral" : "info"}
                    className="font-mono"
                  >
                    {spec.status}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={spec.query}>
                    {spec.query || "-"}
                  </span>
                  {spec.savedMs > 0 ? (
                    <span className="font-mono text-[11px] text-live">-{spec.savedMs.toFixed(0)}ms</span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ----------------------------------------------------- harness */}
        <section className="flex shrink-0 flex-col gap-2">
          <SectionLabel className="flex items-center gap-1.5">
            {blocked.length ? <ShieldAlert size={12} className="text-warn" /> : <ShieldCheck size={12} />}
            Harness audit
          </SectionLabel>
          {tools.length === 0 ? (
            <p className="px-1 text-[11px] text-muted">
              No tool calls yet. Every call is admitted, budgeted and timed before it runs.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {tools.slice(-5).reverse().map((tool) => (
                <div
                  key={tool.callId}
                  className={cn(
                    "rounded-[var(--radius-item)] border px-2.5 py-1.5",
                    tool.status === "blocked"
                      ? "border-warn/45 bg-warn-soft/40"
                      : "border-line bg-surface",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-foreground">{tool.name}</span>
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

        {/* ---------------------------------------------------- timeline */}
        <section className="flex shrink-0 flex-col gap-2">
          <SectionLabel className="flex items-center gap-1.5">
            <History size={12} /> Event timeline
          </SectionLabel>
          <div className="relative flex flex-col gap-0 pl-3">
            <span className="absolute left-[3px] top-1 bottom-1 w-px bg-line" aria-hidden />
            {timeline.length === 0 ? (
              <p className="text-[11px] text-muted">Waiting for the first turn.</p>
            ) : null}
            {timeline.slice(-18).reverse().map((entry) => (
              <div key={entry.id} className="relative py-1.5">
                <span
                  className={cn(
                    "absolute -left-3 top-2.5 h-[7px] w-[7px] rounded-full ring-2 ring-panel",
                    TONE_DOT[entry.tone],
                  )}
                />
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-foreground">{entry.label}</span>
                  <span className="font-mono text-[10px] text-muted">{time(entry.at)}</span>
                </div>
                <p className="text-[11px] leading-snug text-muted">{entry.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="flex shrink-0 items-start gap-1.5 rounded-[var(--radius-item)] bg-subtle px-2.5 py-2 text-[11px] leading-relaxed text-muted">
          <BookOpen size={12} className="mt-0.5 shrink-0" />
          Memory is session-scoped only. Closing this tab ends the session and the server drops
          everything it held.
        </p>
      </div>
    </Panel>
  );
}

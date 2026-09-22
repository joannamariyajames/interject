import { useMemo } from "react";
import { Activity, Gauge, Hand, Sparkles, Timer, Zap } from "lucide-react";
import { SectionLabel } from "~/components/ui/primitives";
import { StatCard } from "~/components/ui/stat";
import { latestMetric, metricAverage, totalSaved, useSession } from "~/store/session";
import { cn } from "~/lib/utils";

const BUCKET_MS = 5000;
const BUCKETS = 36; // three minutes of session at a glance

/**
 * Session activity, five seconds per cell.
 *
 * Same idea as a contribution graph, but every cell is real: it counts the
 * frames the agent actually emitted in that window, so a burst of streaming
 * and a quiet stretch waiting for the user look different.
 */
function ActivityHeatmap() {
  const timeline = useSession((s) => s.timeline);
  const startedAt = useSession((s) => s.startedAt);

  const { cells, peak } = useMemo(() => {
    const counts = new Array(BUCKETS).fill(0);
    for (const event of timeline) {
      const index = Math.floor((event.at - startedAt) / BUCKET_MS);
      if (index >= 0 && index < BUCKETS) counts[index] += 1;
    }
    return { cells: counts, peak: Math.max(1, ...counts) };
  }, [timeline, startedAt]);

  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-1.5">
          <Activity size={12} /> Session activity
        </SectionLabel>
        <span className="text-[10px] text-muted">5s per cell</span>
      </div>

      <div className="grid grid-cols-12 gap-1" role="img" aria-label="Agent activity over the session">
        {cells.map((count, index) => {
          const intensity = count === 0 ? 0 : Math.ceil((count / peak) * 4);
          return (
            <div
              key={index}
              title={`${index * 5}-${index * 5 + 5}s - ${count} event${count === 1 ? "" : "s"}`}
              className={cn(
                "aspect-square rounded-[4px] transition-colors duration-300",
                intensity === 0 && "bg-[var(--heat-0)]",
                intensity === 1 && "bg-fill-teal/30",
                intensity === 2 && "bg-fill-teal/55",
                intensity === 3 && "bg-fill-teal/80",
                intensity >= 4 && "bg-fill-teal",
              )}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-1 text-[10px] text-muted">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={cn(
              "h-2.5 w-2.5 rounded-[3px]",
              level === 0 && "bg-[var(--heat-0)]",
              level === 1 && "bg-fill-teal/30",
              level === 2 && "bg-fill-teal/55",
              level === 3 && "bg-fill-teal/80",
              level === 4 && "bg-fill-teal",
            )}
          />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}

/** Every interruption this session, as measured. */
function YieldChart() {
  const metrics = useSession((s) => s.metrics);
  const yields = useMemo(
    () => metrics.filter((m) => m.name === "time_to_yield").map((m) => m.value),
    [metrics],
  );

  if (!yields.length) {
    return (
      <section className="flex shrink-0 flex-col gap-2">
        <SectionLabel className="flex items-center gap-1.5">
          <Timer size={12} /> Time to yield
        </SectionLabel>
        <p className="rounded-[var(--radius-item)] border border-dashed border-line px-3 py-4 text-center text-[11px] text-muted">
          Interrupt the agent to record one.
        </p>
      </section>
    );
  }

  const peak = Math.max(...yields, 1);
  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-1.5">
          <Timer size={12} /> Time to yield
        </SectionLabel>
        <span className="font-mono text-[10px] text-muted">peak {peak.toFixed(1)} ms</span>
      </div>
      <div className="flex h-20 items-end gap-1 rounded-[var(--radius-item)] border border-line bg-surface p-2">
        {yields.slice(-24).map((value, index) => (
          <div
            key={index}
            title={`interruption ${index + 1}: ${value.toFixed(2)} ms`}
            style={{ height: `${Math.max((value / peak) * 100, 6)}%` }}
            className="w-full max-w-[22px] min-w-[4px] flex-1 rounded-[3px] bg-accent/85 transition-all duration-300 hover:bg-accent"
          />
        ))}
      </div>
    </section>
  );
}

export function StatsView() {
  const { metrics, specs, interruptions, resumes, messages, totalTokens, startedAt } = useSession();

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
  const minutes = Math.max((Date.now() - startedAt) / 60000, 0.1);

  return (
    <div className="scrollable flex min-h-0 flex-1 flex-col gap-5 p-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          fill="accent"
          icon={<Hand size={16} />}
          label="Avg time to yield"
          value={avgYield === null ? "--" : avgYield.toFixed(2)}
          unit="ms"
          hint={`${interruptions} interruption${interruptions === 1 ? "" : "s"} handled`}
        />
        <StatCard
          fill="teal"
          icon={<Zap size={16} />}
          label="Saved by speculation"
          value={saved > 0 ? saved.toFixed(0) : "0"}
          unit="ms"
          hint={
            skipped > 0
              ? `+${skipped.toFixed(0)} ms skipped via checkpoints`
              : hitRate === null
                ? "starts before you finish"
                : `${hitRate}% of guesses reused`
          }
        />
        <StatCard
          fill="blue"
          icon={<Sparkles size={16} />}
          label="Tokens streamed"
          value={totalTokens.toLocaleString()}
          hint={`${turns} turn${turns === 1 ? "" : "s"} this session`}
        />
        <StatCard
          fill="violet"
          icon={<Gauge size={16} />}
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
        <StatCard
          fill="slate"
          label="Turn rate"
          value={(turns / minutes).toFixed(1)}
          unit="/min"
          hint={`${minutes.toFixed(1)} min of session`}
        />
      </div>

      <ActivityHeatmap />
      <YieldChart />

      <p className="shrink-0 rounded-[var(--radius-item)] bg-subtle px-3 py-2.5 text-[11px] leading-relaxed text-muted">
        Every number here is measured from this session, not estimated. Time to yield is the gap
        between the interrupt frame arriving and the turn task being fully stopped.
      </p>
    </div>
  );
}

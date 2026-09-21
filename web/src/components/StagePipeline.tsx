import { motion } from "motion/react";
import { cn } from "~/lib/utils";
import type { Stage } from "~/lib/types";

/** The path a turn walks. Interruption states are drawn off to the side. */
const PIPELINE: { stage: Stage; label: string }[] = [
  { stage: "listening", label: "Listen" },
  { stage: "planning", label: "Plan" },
  { stage: "retrieving", label: "Retrieve" },
  { stage: "reasoning", label: "Reason" },
  { stage: "responding", label: "Respond" },
];

const ORDER: Stage[] = ["listening", "planning", "retrieving", "tooling", "reasoning", "responding"];

export function StagePipeline({ stage, detail }: { stage: Stage; detail: string }) {
  const broken = stage === "interrupted" || stage === "recovering";
  const activeIndex = ORDER.indexOf(stage);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-stretch gap-1">
        {PIPELINE.map((step) => {
          const stepIndex = ORDER.indexOf(step.stage);
          const isActive = !broken && stage === step.stage;
          const isPast = !broken && activeIndex > stepIndex;
          return (
            <div key={step.stage} className="flex-1">
              <div
                className={cn(
                  "h-1.5 rounded-full transition-colors duration-300",
                  broken
                    ? "bg-accent/25"
                    : isActive
                      ? "bg-live"
                      : isPast
                        ? "bg-live/45"
                        : "bg-line",
                )}
              >
                {isActive ? (
                  <motion.div
                    layoutId="stage-glow"
                    className="h-1.5 rounded-full bg-live"
                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  />
                ) : null}
              </div>
              <div
                className={cn(
                  "mt-1.5 truncate text-[10px] font-medium tracking-tight transition-colors",
                  isActive ? "text-live" : isPast ? "text-muted" : "text-muted/60",
                )}
              >
                {step.label}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-item)] border px-2.5 py-2",
          broken ? "border-accent/45 bg-accent-soft/50" : "border-line bg-surface",
        )}
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            broken ? "bg-accent pulse-accent" : stage === "idle" ? "bg-muted" : "bg-live pulse-live",
          )}
        />
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-wider text-foreground">{stage}</div>
          <div className="truncate text-[11px] text-muted" title={detail}>
            {detail || " "}
          </div>
        </div>
      </div>
    </section>
  );
}

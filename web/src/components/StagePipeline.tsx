import { motion } from "motion/react";
import { cn } from "~/lib/utils";
import type { Stage } from "~/lib/types";

/** The path a turn walks, each phase in its own colour. */
const PIPELINE: { stage: Stage; label: string; hue: string }[] = [
  { stage: "listening", label: "Listen", hue: "var(--stage-listening)" },
  { stage: "planning", label: "Plan", hue: "var(--stage-planning)" },
  { stage: "retrieving", label: "Retrieve", hue: "var(--stage-retrieving)" },
  { stage: "reasoning", label: "Reason", hue: "var(--stage-reasoning)" },
  { stage: "responding", label: "Respond", hue: "var(--stage-responding)" },
];

const ORDER: Stage[] = ["listening", "planning", "retrieving", "tooling", "reasoning", "responding"];

export function StagePipeline({ stage, detail }: { stage: Stage; detail: string }) {
  const broken = stage === "interrupted" || stage === "recovering";
  const activeIndex = ORDER.indexOf(stage);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-end gap-1.5">
        {PIPELINE.map((step) => {
          const stepIndex = ORDER.indexOf(step.stage);
          const isActive = !broken && stage === step.stage;
          const isPast = !broken && activeIndex > stepIndex;
          return (
            <div key={step.stage} className="flex-1">
              <div
                className={cn(
                  "relative h-2 overflow-hidden rounded-full transition-all duration-300",
                  isActive && "sweep",
                )}
                style={{
                  background: broken
                    ? "color-mix(in oklab, var(--accent) 22%, var(--line))"
                    : isActive || isPast
                      ? step.hue
                      : "var(--line)",
                  opacity: broken ? 0.5 : isPast ? 0.5 : 1,
                }}
              >
                {isActive ? (
                  <motion.span
                    layoutId="stage-dot"
                    className="absolute inset-0 rounded-full"
                    style={{ background: step.hue }}
                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  />
                ) : null}
              </div>
              <div
                className="mt-1.5 truncate text-[10px] font-semibold tracking-tight transition-colors"
                style={{
                  color: isActive ? step.hue : isPast ? "var(--muted)" : "color-mix(in oklab, var(--muted) 55%, transparent)",
                }}
              >
                {step.label}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "flex items-center gap-2.5 rounded-[var(--radius-item)] px-3 py-2.5",
          broken ? "cut-stripe bg-accent-soft/45" : "bg-surface",
        )}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            broken ? "bg-accent pulse-accent" : stage === "idle" ? "bg-muted" : "pulse-live",
          )}
          style={
            broken || stage === "idle"
              ? undefined
              : { background: PIPELINE.find((p) => p.stage === stage)?.hue ?? "var(--live)" }
          }
        />
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
            {stage}
          </div>
          <div className="truncate text-[11px] text-muted" title={detail}>
            {detail || " "}
          </div>
        </div>
      </div>
    </section>
  );
}

import { AnimatePresence, motion } from "motion/react";
import { Check, CornerDownRight, Layers, Pause } from "lucide-react";
import { Badge, SectionLabel } from "~/components/ui/primitives";
import type { Goal, GoalAction } from "~/lib/types";
import { cn } from "~/lib/utils";

const ACTION_COPY: Record<GoalAction, { label: string; tone: "accent" | "info" | "live" | "warn" | "neutral" }> = {
  push: { label: "new goal", tone: "info" },
  continue: { label: "same goal", tone: "live" },
  refine: { label: "refined", tone: "info" },
  switch: { label: "goal switched", tone: "accent" },
  revert: { label: "resumed earlier goal", tone: "warn" },
  complete: { label: "cleared", tone: "neutral" },
  progress: { label: "working", tone: "live" },
};

const STATUS = {
  active: { icon: CornerDownRight, hue: "var(--accent)", label: "active" },
  parked: { icon: Pause, hue: "var(--fill-amber)", label: "parked" },
  done: { icon: Check, hue: "var(--fill-teal)", label: "done" },
} as const;

export function GoalStack({
  goals,
  action,
  rationale,
}: {
  goals: Goal[];
  action: GoalAction | null;
  rationale: string;
}) {
  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel className="flex items-center gap-1.5 px-0">
          <Layers size={12} /> Goal stack
        </SectionLabel>
        {action ? <Badge tone={ACTION_COPY[action].tone}>{ACTION_COPY[action].label}</Badge> : null}
      </div>

      {rationale ? <p className="text-[11px] leading-relaxed text-muted">{rationale}</p> : null}

      <div className="scrollable flex max-h-72 flex-col gap-2 pr-1">
        {goals.length === 0 ? (
          <p className="py-2 text-[11px] text-muted">
            Nothing tracked yet. The first thing you say becomes the goal.
          </p>
        ) : null}

        <AnimatePresence initial={false}>
          {goals.map((goal, index) => {
            const meta = STATUS[goal.status];
            const Icon = meta.icon;
            const pct = Math.round((goal.progress ?? 0) * 100);
            return (
              <motion.div
                key={goal.goal_id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: goal.status === "done" ? 0.55 : 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="spine"
                style={{ ["--spine-color" as string]: meta.hue }}
              >
                <div className="flex items-start gap-2">
                  <Icon size={13} className="mt-0.5 shrink-0" style={{ color: meta.hue }} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs leading-snug text-foreground">{goal.text}</p>

                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span
                        className="font-mono text-[10px] font-semibold"
                        style={{ color: meta.hue }}
                      >
                        #{index + 1} {meta.label}
                      </span>
                      {goal.constraints.map((constraint) => (
                        <Badge key={constraint} tone="info" className="py-0">
                          {constraint}
                        </Badge>
                      ))}
                    </div>

                    {goal.steps?.length ? (
                      <div className="mt-1.5">
                        <div className="flex items-center justify-between text-[10px] text-muted">
                          <span className="truncate pr-2">
                            {goal.step_index >= goal.steps.length
                              ? "plan complete"
                              : goal.steps[goal.step_index] ?? ""}
                          </span>
                          <span className="font-mono tabular-nums">
                            {goal.step_index}/{goal.steps.length}
                          </span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                          <div
                            className={cn("h-full rounded-full transition-[width] duration-300")}
                            style={{ width: `${pct}%`, background: meta.hue }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

import { AnimatePresence, motion } from "motion/react";
import { CornerDownRight, Layers, Pause, Check } from "lucide-react";
import { Badge, SectionLabel } from "~/components/ui/primitives";
import type { Goal, GoalAction } from "~/lib/types";

const ACTION_COPY: Record<GoalAction, { label: string; tone: "accent" | "info" | "live" | "warn" | "neutral" }> = {
  push: { label: "new goal", tone: "info" },
  continue: { label: "same goal", tone: "live" },
  refine: { label: "refined", tone: "info" },
  switch: { label: "goal switched", tone: "accent" },
  revert: { label: "resumed earlier goal", tone: "warn" },
  complete: { label: "cleared", tone: "neutral" },
};

const STATUS_ICON = {
  active: CornerDownRight,
  parked: Pause,
  done: Check,
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
      <div className="flex items-center justify-between gap-2 px-1">
        <SectionLabel className="flex items-center gap-1.5 px-0">
          <Layers size={12} /> Goal stack
        </SectionLabel>
        {action ? <Badge tone={ACTION_COPY[action].tone}>{ACTION_COPY[action].label}</Badge> : null}
      </div>

      {rationale ? (
        <p className="px-1 text-[11px] leading-relaxed text-muted">{rationale}</p>
      ) : null}

      <div className="scrollable flex max-h-56 flex-col gap-1.5 pr-1">
        <AnimatePresence initial={false}>
          {goals.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted">
              Nothing tracked yet. The first thing you say becomes the goal.
            </p>
          ) : null}

          {goals.map((goal, index) => {
            const Icon = STATUS_ICON[goal.status];
            return (
              <motion.div
                key={goal.goal_id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: goal.status === "done" ? 0.5 : 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className={[
                  "rounded-[var(--radius-item)] border px-2.5 py-2",
                  goal.status === "active"
                    ? "border-accent/45 bg-accent-soft/50"
                    : "border-line bg-surface",
                ].join(" ")}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    size={13}
                    className={goal.status === "active" ? "mt-0.5 shrink-0 text-accent" : "mt-0.5 shrink-0 text-muted"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs leading-snug text-foreground">{goal.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="font-mono text-[10px] text-muted">#{index + 1} {goal.status}</span>
                      {goal.constraints.map((constraint) => (
                        <Badge key={constraint} tone="info" className="py-0">
                          {constraint}
                        </Badge>
                      ))}
                    </div>
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

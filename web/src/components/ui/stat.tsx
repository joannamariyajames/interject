import * as React from "react";
import { cn } from "~/lib/utils";

export type Fill = "teal" | "blue" | "violet" | "amber" | "slate" | "accent";

const FILLS: Record<Fill, string> = {
  teal: "bg-fill-teal text-fill-teal-ink",
  blue: "bg-fill-blue text-fill-blue-ink",
  violet: "bg-fill-violet text-fill-violet-ink",
  amber: "bg-fill-amber text-fill-amber-ink",
  slate: "bg-fill-slate text-fill-slate-ink",
  accent: "bg-accent text-accent-foreground",
};

/**
 * A big number on a solid colour.
 *
 * The LastChat statistics screen reads well because the value carries the
 * colour rather than sitting inside a tinted outline, so the eye lands on the
 * number first and the label second.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  fill = "slate",
  icon,
  wide = false,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  fill?: Fill;
  icon?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-between rounded-[var(--radius-card)] p-3.5",
        "transition-transform duration-200 hover:-translate-y-0.5",
        FILLS[fill],
        wide && "col-span-2",
      )}
    >
      {icon ? <div className="mb-3 opacity-70">{icon}</div> : null}
      <div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-2xl leading-none font-semibold tabular-nums">{value}</span>
          {unit ? <span className="text-xs font-medium opacity-70">{unit}</span> : null}
        </div>
        <div className="mt-1.5 text-[11px] font-medium opacity-80">{label}</div>
        {hint ? <div className="mt-0.5 truncate text-[10px] opacity-65" title={hint}>{hint}</div> : null}
      </div>
    </div>
  );
}

import { cn } from "~/lib/utils";

export type Fill = "teal" | "blue" | "violet" | "amber" | "slate" | "accent";

const HUE: Record<Fill, string> = {
  teal: "var(--fill-teal)",
  blue: "var(--fill-blue)",
  violet: "var(--fill-violet)",
  amber: "var(--fill-amber)",
  slate: "var(--muted)",
  accent: "var(--accent)",
};

/**
 * A measurement, set like a figure in a magazine.
 *
 * Colour is a one-pixel keyline and the numeral, not a flood fill: on black,
 * a solid colour block reads as a template, while a hairline and a warm
 * numeral read as considered.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  fill = "slate",
  hero = false,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  fill?: Fill;
  hero?: boolean;
}) {
  const hue = HUE[fill];
  return (
    <div
      className={cn(
        "keyline group flex min-w-0 flex-col justify-between rounded-[var(--radius-card)]",
        "border border-line/70 bg-surface/60 px-3.5 py-3 backdrop-blur-sm",
        "transition-colors duration-300 hover:border-line",
        hero && "col-span-2 px-4 py-4",
      )}
      style={{ ["--keyline-color" as string]: hue }}
    >
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        {/* Sans, not the display serif. Instrument Serif's numerals are lovely
            at headline size and unreadable at 28px - a zero reads as "()". */}
        <span
          className={cn(
            "font-light tabular-nums leading-none tracking-[-0.03em]",
            hero ? "text-[2.4rem]" : "text-[1.6rem]",
          )}
          style={{ color: hue }}
        >
          {value}
        </span>
        {unit ? <span className="text-[11px] font-medium text-muted">{unit}</span> : null}
      </div>
      {hint ? (
        <div className="mt-1.5 truncate text-[10.5px] leading-relaxed text-muted" title={hint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

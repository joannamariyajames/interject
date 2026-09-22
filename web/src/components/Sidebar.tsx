import { useEffect, useState } from "react";
import { Moon, Play, RotateCcw, Square, Sun, Trash2, Wand2 } from "lucide-react";
import { Badge, Button, Panel, SectionLabel, Toggle } from "~/components/ui/primitives";
import { GoalStack } from "~/components/GoalStack";
import { Logo } from "~/components/Logo";
import { useScenarios } from "~/lib/scenarios";
import { useSession } from "~/store/session";
import { cn } from "~/lib/utils";

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("interject-theme");
    if (stored) return stored === "dark";
    return !window.matchMedia("(prefers-color-scheme: light)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("interject-theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, toggle: () => setDark((value) => !value) };
}

export function Sidebar({ onAction }: { onAction?: () => void } = {}) {
  const { goals, goalAction, goalRationale, strictHarness, setStrictHarness, tokenDelayMs, setTokenDelay, reset, provider, sessionId, speculationOn } =
    useSession();
  const { scenarios, running, run, stop } = useScenarios();
  const { dark, toggle } = useTheme();

  return (
    <Panel className="w-[286px] shrink-0 overflow-hidden">
      <header className="flex items-center gap-2.5 border-b border-line/70 px-4 py-4">
        <Logo />
        <div className="min-w-0">
          <h1 className="display text-lg leading-none">Interject</h1>
          <p className="eyebrow mt-1 truncate">Interruptible agent</p>
        </div>
        <button
          onClick={toggle}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] text-muted transition-colors hover:bg-subtle hover:text-foreground"
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      <div className="scrollable flex min-h-0 flex-1 flex-col gap-5 p-4">
        <div className="shrink-0">
          <GoalStack goals={goals} action={goalAction} rationale={goalRationale} />
        </div>

        {/* ---------------------------------------------------- scenarios */}
        <section className="flex shrink-0 flex-col gap-2">
          <SectionLabel className="flex items-center gap-1.5">
            <Wand2 size={12} /> Scripted demos
          </SectionLabel>
          <div className="flex flex-col gap-1.5">
            {scenarios.map((scenario) => {
              const isRunning = running === scenario.id;
              return (
                <button
                  key={scenario.id}
                  onClick={() => {
                    onAction?.();
                    if (isRunning) stop();
                    else void run(scenario);
                  }}
                  disabled={running !== null && !isRunning}
                  className={cn(
                    "group rounded-[var(--radius-item)] border px-2.5 py-2 text-left transition-colors",
                    "disabled:opacity-40",
                    isRunning
                      ? "border-accent/50 bg-accent-soft/35"
                      : "border-line/60 bg-surface/40 hover:border-line",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition-colors",
                        isRunning
                          ? "bg-accent text-accent-foreground"
                          : "border border-line/70 text-muted group-hover:border-accent/50 group-hover:text-accent",
                      )}
                    >
                      {isRunning ? <Square size={12} /> : <Play size={12} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{scenario.title}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={isRunning ? "accent" : "neutral"} className="py-0">
                          {isRunning ? "running" : `${scenario.steps.length} step${scenario.steps.length === 1 ? "" : "s"}`}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-muted">{scenario.blurb}</p>
                    </div>
                  </div>
                </button>
              );
            })}
            {scenarios.length === 0 ? (
              <p className="px-1 text-[11px] text-muted">Scenario list unavailable.</p>
            ) : null}
          </div>
        </section>

        {/* ----------------------------------------------------- controls */}
        <section className="flex shrink-0 flex-col gap-1.5">
          <SectionLabel>Runtime</SectionLabel>

          <Toggle
            checked={strictHarness}
            onChange={setStrictHarness}
            label="Strict harness"
            hint="Refuse unknown params and irreversible calls"
          />

          <div className="rounded-[var(--radius-item)] px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Speaking pace</span>
              <span className="font-mono text-[11px] text-muted">{tokenDelayMs} ms/token</span>
            </div>
            <input
              type="range"
              min={0}
              max={120}
              step={2}
              value={tokenDelayMs}
              aria-label="Milliseconds between tokens"
              onChange={(event) => setTokenDelay(Number(event.target.value))}
              className="mt-2 w-full accent-[var(--accent)]"
            />
            <p className="mt-1 text-[11px] text-muted">Slow it down to make barging in easier.</p>
          </div>

          <Button variant="outline" size="sm" className="mt-1 justify-start" onClick={reset}>
            <Trash2 size={13} /> Clear session memory
          </Button>
        </section>
      </div>

      <footer className="flex flex-wrap items-center gap-1.5 border-t border-line/70 px-4 py-3">
        <Badge tone={speculationOn ? "live" : "neutral"}>
          <RotateCcw size={10} /> speculation {speculationOn ? "on" : "off"}
        </Badge>
        <Badge tone="info" className="font-mono">{provider}</Badge>
        {sessionId ? (
          <Badge tone="neutral" className="font-mono" title="Session-scoped. Dropped on disconnect.">
            {sessionId.slice(0, 6)}
          </Badge>
        ) : null}
      </footer>
    </Panel>
  );
}

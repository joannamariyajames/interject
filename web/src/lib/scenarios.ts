import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "~/store/session";
import type { Scenario } from "./types";

const sleep = (msValue: number) => new Promise((resolve) => setTimeout(resolve, msValue));

/**
 * Replays a scripted scenario against the live socket.
 *
 * Deliberately drives the same public actions a human would, so a scenario
 * cannot pass in a way a real user could not reproduce by hand.
 */
export function useScenarioRunner() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/scenarios")
      .then((response) => response.json())
      .then((data) => {
        if (alive) setScenarios(data.scenarios ?? []);
      })
      .catch(() => {
        /* the demo still works by hand without the scripted list */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const run = useCallback(async (scenario: Scenario) => {
    const { submit, interrupt } = useSession.getState();
    cancelled.current = false;
    setRunning(scenario.id);

    for (const step of scenario.steps) {
      if (cancelled.current) break;

      if (step.kind === "say" && step.text) {
        submit(step.text);
        await sleep(450);
      } else if (step.kind === "interrupt") {
        interrupt("barge_in");
        await sleep(500);
      } else if (step.kind === "wait_tokens") {
        const target = step.count ?? 10;
        const deadline = Date.now() + 8000;
        while (useSession.getState().tokensThisTurn < target && Date.now() < deadline) {
          if (cancelled.current) break;
          await sleep(40);
        }
      }
    }

    // Let the closing turn finish before releasing the button.
    const deadline = Date.now() + 12000;
    while (useSession.getState().stage !== "idle" && Date.now() < deadline) {
      if (cancelled.current) break;
      await sleep(80);
    }
    setRunning(null);
  }, []);

  const stop = useCallback(() => {
    cancelled.current = true;
    setRunning(null);
  }, []);

  return { scenarios, running, run, stop };
}

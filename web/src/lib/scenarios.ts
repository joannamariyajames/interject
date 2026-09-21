import { useEffect } from "react";
import { useSession } from "~/store/session";

/**
 * Loads the scripted scenarios once per app.
 *
 * The *running* of a scenario deliberately lives in the store, not in a
 * component: the sidebar exists twice (docked and in the narrow-window drawer)
 * and the drawer unmounts the moment a scenario starts it. A runner owned by a
 * component would be cancelled by its own success.
 */
export function useScenarios() {
  const loadScenarios = useSession((s) => s.loadScenarios);
  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  return {
    scenarios: useSession((s) => s.scenarios),
    running: useSession((s) => s.runningScenario),
    run: useSession((s) => s.runScenario),
    stop: useSession((s) => s.stopScenario),
  };
}

import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen, Wifi, WifiOff } from "lucide-react";
import { Badge, Button, Panel } from "~/components/ui/primitives";
import { Composer } from "~/components/Composer";
import { MindRail } from "~/components/MindRail";
import { Sidebar } from "~/components/Sidebar";
import { Transcript } from "~/components/Transcript";
import { useSession } from "~/store/session";

function ConnectionBadge() {
  const status = useSession((s) => s.status);
  if (status === "open") {
    return (
      <Badge tone="live">
        <Wifi size={11} /> connected
      </Badge>
    );
  }
  return (
    <Badge tone={status === "connecting" ? "warn" : "danger"}>
      <WifiOff size={11} /> {status === "connecting" ? "connecting" : "reconnecting"}
    </Badge>
  );
}

export default function App() {
  const connect = useSession((s) => s.connect);
  const disconnect = useSession((s) => s.disconnect);
  const stage = useSession((s) => s.stage);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= 1280);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <div className="flex h-full gap-3 p-3">
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      <Panel className="min-w-0 flex-1 overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">Live session</h2>
            <p className="truncate text-[11px] text-muted">
              Full duplex - it keeps working while you type, and stops the moment you cut in
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ConnectionBadge />
            {stage === "interrupted" ? <Badge tone="accent">interrupted</Badge> : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={railOpen ? "Hide agent mind panel" : "Show agent mind panel"}
              onClick={() => setRailOpen((open) => !open)}
              className="hidden xl:inline-flex"
            >
              {railOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </Button>
          </div>
        </header>

        <Transcript />
        <Composer />
      </Panel>

      {railOpen ? (
        <div className="hidden xl:flex">
          <MindRail />
        </div>
      ) : null}
    </div>
  );
}

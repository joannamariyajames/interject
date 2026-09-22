import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, PanelRightClose, PanelRightOpen, Wifi, WifiOff, X } from "lucide-react";
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
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // The drawer only exists below md; if the window grows past it, drop the
  // overlay rather than leaving two sidebars on screen.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = () => query.matches && setNavOpen(false);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="flex h-full gap-3 p-3">
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Narrow windows reach the same controls through a slide-over. Escape is
          reserved for barging in, so this closes on the backdrop or the X. */}
      <AnimatePresence>
        {navOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              aria-label="Close menu"
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setNavOpen(false)}
            />
            <motion.div
              className="relative z-10 h-full max-w-[86vw] p-3"
              initial={{ x: -24 }}
              animate={{ x: 0 }}
              exit={{ x: -24 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            >
              <Sidebar onAction={() => setNavOpen(false)} />
              <Button
                variant="outline"
                size="icon"
                aria-label="Close menu"
                onClick={() => setNavOpen(false)}
                className="absolute -right-1 top-5"
              >
                <X size={15} />
              </Button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Panel className="min-w-0 flex-1 overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-line/70 px-5 py-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            onClick={() => setNavOpen(true)}
            className="-ml-2 md:hidden"
          >
            <Menu size={17} />
          </Button>

          <div className="min-w-0">
            <h2 className="display truncate text-base leading-none">Live session</h2>
            <p className="eyebrow mt-1 truncate">
              Full duplex &middot; it stops the moment you cut in
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
              className="hidden lg:inline-flex"
            >
              {railOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </Button>
          </div>
        </header>

        <Transcript />
        <Composer />
      </Panel>

      {railOpen ? (
        <div className="hidden lg:flex">
          <MindRail />
        </div>
      ) : null}
    </div>
  );
}

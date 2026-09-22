import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AudioLines, ImageIcon, Scissors, Sparkles, User } from "lucide-react";
import { Badge } from "~/components/ui/primitives";
import { useSession } from "~/store/session";
import { cn } from "~/lib/utils";
import type { ChatMessage } from "~/lib/types";

const MODALITY_ICON = {
  text: null,
  voice: AudioLines,
  image: ImageIcon,
} as const;

function Evidence({ message }: { message: ChatMessage }) {
  const docs = (message.meta?.evidence as string[] | undefined) ?? [];
  if (!docs.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted">grounded in</span>
      {docs.map((doc) => (
        <Badge key={doc} tone="info" className="font-mono">
          {doc}
        </Badge>
      ))}
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  const Icon = MODALITY_ICON[message.modality];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex justify-end gap-2.5"
    >
      <div className="max-w-[78%] rounded-[var(--radius-card)] rounded-br-[8px] bg-accent px-4 py-2.5 text-accent-foreground shadow-[var(--shadow-soft)]">
        {Icon ? (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
            <Icon size={11} /> {message.modality} input
          </div>
        ) : null}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
      </div>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-muted">
        <User size={13} />
      </div>
    </motion.div>
  );
}

function AgentBubble({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  const interrupted = message.status === "interrupted";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex gap-2.5"
    >
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          interrupted ? "bg-accent-soft text-accent" : "bg-live-soft text-live",
        )}
      >
        <Sparkles size={13} />
      </div>

      <div className="min-w-0 max-w-[82%] flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-foreground">Interject</span>
          {typeof message.meta?.latency_ms === "number" ? (
            <Badge tone="neutral" className="font-mono">
              {((message.meta.latency_ms as number) / 1000).toFixed(1)}s
            </Badge>
          ) : null}
          {streaming ? <Badge tone="live">streaming</Badge> : null}
          {message.status === "resumed" ? (
            <Badge tone="warn">resumed from checkpoint</Badge>
          ) : null}
          {interrupted ? <Badge tone="accent">cut short</Badge> : null}
        </div>

        <div
          className={cn(
            "rounded-[var(--radius-card)] rounded-tl-[8px] border px-4 py-3",
            interrupted
              ? "border-dashed border-accent/55 bg-accent-soft/35"
              : "border-line bg-surface shadow-[var(--shadow-soft)]",
          )}
        >
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {message.content}
            {streaming ? <span className="stream-caret" aria-hidden /> : null}
          </p>

          {interrupted ? (
            <div className="mt-2.5 flex items-center gap-2 border-t border-dashed border-accent/45 pt-2 text-[11px] text-accent">
              <Scissors size={12} className="shrink-0" />
              <span>
                You cut in here. The work up to this point is held in a checkpoint - say
                &ldquo;go on&rdquo; to continue it, or just change the subject.
              </span>
            </div>
          ) : null}

          {!streaming && !interrupted ? <Evidence message={message} /> : null}
        </div>
      </div>
    </motion.div>
  );
}

const OPENERS = [
  "What are the baggage limits on each cabin?",
  "Find me a flight from Bengaluru to Mumbai on Friday",
  "What happens to my refund if I cancel?",
];

function EmptyState() {
  const submit = useSession((s) => s.submit);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-card)] bg-accent-soft text-accent">
        <AudioLines size={24} />
      </div>
      <div className="max-w-md">
        <h2 className="text-xl font-semibold tracking-tight">Talk over it on purpose</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This agent starts retrieving before you finish typing, keeps answering while you type
          again, and holds a checkpoint the moment you cut in. Ask something, then interrupt it
          mid-sentence and watch what it keeps.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {OPENERS.map((opener) => (
          <button
            key={opener}
            onClick={() => submit(opener)}
            className="rounded-[var(--radius-pill)] border border-line bg-surface px-3.5 py-2 text-xs text-muted transition-colors hover:border-accent/50 hover:text-foreground"
          >
            {opener}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Transcript() {
  const messages = useSession((s) => s.messages);
  const streaming = useSession((s) => s.streaming);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Stick to the bottom unless the reader has scrolled up to look at something.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = () => {
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pinned.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming?.text]);

  const empty = messages.length === 0 && !streaming;

  return (
    <div ref={scrollRef} className="scrollable min-h-0 flex-1">
      {empty ? (
        <EmptyState />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6">
          <AnimatePresence initial={false}>
            {messages.map((message) =>
              message.role === "user" ? (
                <UserBubble key={`${message.turnId}-u`} message={message} />
              ) : (
                <AgentBubble key={`${message.turnId}-a`} message={message} />
              ),
            )}
          </AnimatePresence>

          {streaming ? (
            <AgentBubble
              streaming
              message={{
                turnId: streaming.turnId,
                role: "agent",
                content: streaming.text,
                status: "streaming",
                modality: "text",
                at: Date.now(),
              }}
            />
          ) : null}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

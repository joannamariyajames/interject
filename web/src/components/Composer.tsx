import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, AudioLines, Hand, ImageIcon, Keyboard, Mic, Square } from "lucide-react";
import { Button } from "~/components/ui/primitives";
import { useVoiceReplay } from "~/lib/voice";
import { useSession } from "~/store/session";
import { cn } from "~/lib/utils";
import type { Modality } from "~/lib/types";

const MODALITIES: { id: Modality; icon: typeof Keyboard; label: string; hint: string }[] = [
  { id: "text", icon: Keyboard, label: "Text", hint: "Type normally" },
  { id: "voice", icon: AudioLines, label: "Voice", hint: "Simulated from a transcript, as the brief allows" },
  { id: "image", icon: ImageIcon, label: "Image", hint: "Describe an attached image alongside the question" },
];

/** Three bars that bounce while the agent is mid-answer. */
function LiveWave() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {[0, 0.15, 0.3].map((delay) => (
        <span
          key={delay}
          className="wave-bar h-3 w-[3px] rounded-full bg-current"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  );
}

export function Composer() {
  const { draft, setDraft, submit, interrupt, modality, setModality, stage, status } = useSession();
  const { transcripts, speaking, speak, stop } = useVoiceReplay();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agentSpeaking = stage === "responding" || stage === "reasoning" || stage === "retrieving" || stage === "planning";

  // Auto-grow, capped so the transcript never gets squeezed out.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft]);

  // Escape is the keyboard barge-in. It works from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        interrupt("barge_in");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interrupt]);

  return (
    <div className="shrink-0 border-t border-line/70 px-5 py-4 backdrop-blur-xl">
      <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
        <AnimatePresence>
          {agentSpeaking ? (
            <motion.div
              initial={{ opacity: 0, y: 6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: 6, height: 0 }}
              className="flex items-center gap-2.5 overflow-hidden"
            >
              <Button
                variant="primary"
                size="sm"
                onClick={() => interrupt("barge_in")}
                className="pulse-accent"
              >
                <Hand size={13} /> Interrupt
              </Button>
              <span className="flex items-center gap-2 text-[11px] text-muted">
                <span className="text-live">
                  <LiveWave />
                </span>
                Agent is working. Press{" "}
                <kbd className="rounded border border-line bg-surface px-1 font-mono text-[10px]">Esc</kbd>{" "}
                or just start typing - both count as barging in.
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {transcripts.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="eyebrow flex items-center gap-1.5">
              <Mic size={10} /> Speak
            </span>
            {transcripts.map((transcript) => {
              const isSpeaking = speaking === transcript.id;
              return (
                <button
                  key={transcript.id}
                  onClick={() => (isSpeaking ? stop() : void speak(transcript))}
                  disabled={speaking !== null && !isSpeaking}
                  title={transcript.text}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40",
                    isSpeaking
                      ? "border-live bg-live-soft text-live"
                      : "border-line/70 text-muted hover:border-live/60 hover:text-foreground",
                  )}
                >
                  {isSpeaking ? <Square size={9} /> : <Mic size={10} />}
                  {transcript.label}
                </button>
              );
            })}
            <span className="text-[10px] text-muted">
              replayed word by word - cut in while it talks
            </span>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-end gap-2 rounded-[var(--radius-panel)] border bg-surface/55 p-2 backdrop-blur-sm transition-colors",
            agentSpeaking ? "border-accent/45" : speaking ? "border-live/60" : "border-line",
          )}
        >
          <div className="flex shrink-0 gap-0.5 self-end pb-0.5">
            {MODALITIES.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  title={`${option.label} - ${option.hint}`}
                  aria-label={option.label}
                  aria-pressed={modality === option.id}
                  onClick={() => setModality(option.id)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-[var(--radius-pill)] transition-colors",
                    modality === option.id
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-subtle hover:text-foreground",
                  )}
                >
                  <Icon size={15} />
                </button>
              );
            })}
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            disabled={status !== "open"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              status === "open"
                ? "Say something, or cut in mid-answer"
                : "Reconnecting to the agent..."
            }
            className="max-h-42 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted disabled:opacity-50"
          />

          <Button
            variant="primary"
            size="icon"
            aria-label="Send"
            disabled={!draft.trim() || status !== "open"}
            onClick={() => submit()}
            className="self-end"
          >
            <ArrowUp size={16} />
          </Button>
        </div>

        <p className="px-1 text-[11px] text-muted">
          Retrieval starts on the partial text as you type, before you press enter.
        </p>
      </div>
    </div>
  );
}

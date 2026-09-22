import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "~/store/session";
import type { Transcript } from "./types";

const sleep = (msValue: number) => new Promise((resolve) => setTimeout(resolve, msValue));

/**
 * Simulated voice input, replayed from a transcript.
 *
 * The brief allows voice to be simulated from transcripts, so rather than
 * pasting a finished sentence this walks the words at a speaking cadence and
 * pushes each growing prefix through the same partial channel a real recogniser
 * would use. That means speculative retrieval fires mid-sentence exactly as it
 * would on live speech, and you can barge in while "speaking".
 */
export function useVoiceReplay() {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const abort = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/transcripts")
      .then((r) => r.json())
      .then((d) => alive && setTranscripts(d.transcripts ?? []))
      .catch(() => {
        /* the demo still works by typing */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => {
    abort.current = true;
  }, []);

  const speak = useCallback(async (transcript: Transcript) => {
    const { setDraft, submit, setModality } = useSession.getState();
    abort.current = false;
    setSpeaking(transcript.id);
    setModality("voice");

    const words = transcript.text.split(/\s+/);
    const perWord = 60000 / Math.max(transcript.wpm, 60);

    let spoken = "";
    for (const word of words) {
      if (abort.current) break;
      spoken = spoken ? `${spoken} ${word}` : word;
      setDraft(spoken);
      // Natural speech is uneven; a flat cadence is the tell that it is fake.
      await sleep(perWord * (0.7 + Math.random() * 0.6));
    }

    if (!abort.current) {
      await sleep(240); // the beat before a speaker stops
      submit(spoken);
    }
    setSpeaking(null);
  }, []);

  const stop = useCallback(() => {
    abort.current = true;
    setSpeaking(null);
  }, []);

  return { transcripts, speaking, speak, stop };
}

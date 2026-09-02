"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type { AgentMsg } from "../lib/host";
import type { ChatMessage } from "@/features/appshell";

type LoadArg = { id: string; createdAt: number; messages: unknown[]; history: unknown[] };

// Persists the current Alfa conversation to a YAML thread (/api/threads) and
// restores one. Owns the current thread id + creation time; the panel owns the
// display messages + the wire history (passed in), so save/resume carry both.
export function useThreadPersistence(
  historyRef: { current: AgentMsg[] },
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  stop: () => void,
) {
  const threadIdRef = useRef<string | null>(null);
  const createdAtRef = useRef<number>(0);

  const persist = useCallback(
    (msgs: ChatMessage[]) => {
      if (msgs.length === 0) return;
      if (!threadIdRef.current) {
        threadIdRef.current = `thread_${Date.now().toString(36)}`;
        createdAtRef.current = Date.now();
      }
      const firstUser = msgs.find((m) => m.role === "user");
      void fetch("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: threadIdRef.current,
          title: (firstUser?.text ?? "New chat").slice(0, 80),
          createdAt: createdAtRef.current,
          messages: msgs,
          history: historyRef.current,
        }),
      }).catch(() => {});
    },
    [historyRef],
  );

  const loadThread = useCallback(
    (t: LoadArg) => {
      stop();
      threadIdRef.current = t.id;
      createdAtRef.current = t.createdAt || Date.now();
      historyRef.current = (t.history ?? []) as AgentMsg[];
      setMessages((t.messages ?? []) as ChatMessage[]);
    },
    [stop, historyRef, setMessages],
  );

  const newThread = useCallback(() => {
    stop();
    threadIdRef.current = null;
    createdAtRef.current = 0;
    historyRef.current = [];
    setMessages([]);
  }, [stop, historyRef, setMessages]);

  return { persist, loadThread, newThread };
}

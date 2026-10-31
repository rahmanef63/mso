"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import type { AgentMsg } from "../lib/host";
import type { ChatMessage } from "@/features/appshell/alfa";
import { clearAlfaRunState, newAlfaApprovalSession } from "@/features/appshell/alfa";

type LoadArg = { id: string; title?: string; createdAt: number; messages: unknown[]; history: unknown[] };

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
  const titleOverrideRef = useRef<string | null>(null);

  const setThreadTitle = useCallback((title: string) => {
    titleOverrideRef.current = title;
  }, []);

  const persist = useCallback(
    (msgs: ChatMessage[]) => {
      if (msgs.length === 0) return;
      if (!threadIdRef.current) {
        threadIdRef.current = `thread_${Date.now().toString(36)}`;
        createdAtRef.current = Date.now();
      }
      const firstUser = msgs.find((m) => m.role === "user");
      const title = titleOverrideRef.current ?? (firstUser?.text ?? "New chat").slice(0, 80);
      void fetch("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: threadIdRef.current,
          title,
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
      clearAlfaRunState();
      newAlfaApprovalSession();
      threadIdRef.current = t.id;
      createdAtRef.current = t.createdAt || Date.now();
      titleOverrideRef.current = t.title ?? null;
      historyRef.current = (t.history ?? []) as AgentMsg[];
      setMessages((t.messages ?? []) as ChatMessage[]);
    },
    [stop, historyRef, setMessages],
  );

  const newThread = useCallback(() => {
    stop();
    clearAlfaRunState();
    newAlfaApprovalSession();
    threadIdRef.current = null;
    createdAtRef.current = 0;
    titleOverrideRef.current = null;
    historyRef.current = [];
    setMessages([]);
  }, [stop, historyRef, setMessages]);

  return { persist, loadThread, newThread, setThreadTitle };
}

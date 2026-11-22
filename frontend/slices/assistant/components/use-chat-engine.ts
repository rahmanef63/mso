"use client";

import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { errText } from "./error-text";
import {
  awaitAlfaApproval, clearAlfaApprovals, sendToAlfa, alfaRunState, setAlfaOperation,
  pulseAlfaRun, recordAlfaRunActivity, endAlfaRunState, stopAlfaRunState,
  type ChatMessage, type ToolCard, alfaProjectContext,
} from "@/features/appshell/alfa";
import { runToolAgent, useOsApi, type AgentMsg } from "../lib/host";
import type { ProviderUsage } from "./turn-usage";
import { activeAgent } from "../lib/store";
import { composeSystem } from "../lib/agent-request";
import { rewindToUserTurn } from "../lib/chat-history";
import { useHostCommands, type HostToolUi } from "../host-tools/use-host-commands";
import { beginAlfaRun, finishAlfaRun } from "../lib/alfa-activity";

let seq = 0;
const nextId = () => `m${Date.now()}-${seq++}`;

export function useChatEngine({
  messages,
  setMessages,
  historyRef,
  streaming,
  persist,
  recordUsage,
}: {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  historyRef: { current: AgentMsg[] };
  streaming: boolean;
  persist: (msgs: ChatMessage[]) => void;
  recordUsage: (usage?: ProviderUsage) => void;
}) {
  const api = useOsApi();
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const pushCard = useCallback((id: string, card: ToolCard) => {
    setAlfaOperation(card.name, card.status === "pending");
    recordAlfaRunActivity(id, card.name, card.status);
    setMessages((prev) => [...prev, { id, createdAt: Date.now(), role: "tool", tool: card }]);
  }, [setMessages]);

  const updateCard = useCallback((id: string, patch: Partial<ToolCard>) => {
    if (patch.status) {
      recordAlfaRunActivity(id, "", patch.status);
      setAlfaOperation(patch.status === "running" ? "Executing tool" : "Requesting response");
    }
    setMessages((prev) => prev.map((m) => (m.id === id && m.tool ? { ...m, tool: { ...m.tool, ...patch } } : m)));
  }, [setMessages]);

  const requestApproval = useCallback((id: string) => awaitAlfaApproval(id), []);
  const ui = useMemo<HostToolUi>(() => ({ pushCard, updateCard, requestApproval }), [pushCard, updateCard, requestApproval]);
  const { tools, invoke } = useHostCommands(ui);

  const stop = useCallback(() => {
    stopAlfaRunState();
    abortRef.current?.abort();
    abortRef.current = null;
    clearAlfaApprovals();
  }, []);

  useEffect(() => stop, [stop]);

  const send = useCallback(
    async (text: string, fromAppId?: string, appContext?: string) => {
      const a = activeAgent();
      const createdAt = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: nextId(), createdAt, role: "user", text, appId: fromAppId },
        { id: nextId(), createdAt, role: "assistant", text: "", appId: fromAppId },
      ]);
      const prevHistory = historyRef.current.slice();
      historyRef.current = [...prevHistory, { role: "user", text }];

      const patchLastAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => {
          const next = [...prev];
          for (let k = next.length - 1; k >= 0; k--) {
            if (next[k].role === "assistant") { next[k] = fn(next[k]); break; }
          }
          return next;
        });

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const modeNote =
        api.mode === "live"
          ? " You are in LIVE mode on a production VPS; tool actions are real."
          : " You are in MOCK mode: fs, exec and sys tools are simulated (no real VPS). The skills.* and memory.* tools are NOT simulated; they read and write real host state even here.";
      const runId = beginAlfaRun(text);
      const stateId = alfaRunState()?.id;
      setAlfaOperation("Requesting response");
      let runOk = false;
      try {
        const { history: next, outcome, usage } = await runToolAgent(
          historyRef.current,
          tools,
          invoke,
          {
            onDelta: (c) => { pulseAlfaRun(); patchLastAssistant((m) => ({ ...m, text: (m.text ?? "") + c })); },
            onReasoning: (r) => { pulseAlfaRun(); patchLastAssistant((m) => ({ ...m, reasoning: (m.reasoning ?? "") + r })); },
            onTool: () => setMessages((prev) => [...prev, { id: nextId(), createdAt: Date.now(), role: "assistant", text: "" }]),
          },
          8,
          composeSystem(a, modeNote, alfaProjectContext(), appContext),
          ctrl.signal,
        );
        historyRef.current = next;
        recordUsage(usage);
        runOk = outcome === "completed";
        if (outcome === "limit") {
          patchLastAssistant((m) => ({
            ...m,
            text: `${m.text ?? ""}\n\nTurn limit reached. Execution has stopped; send a new message to continue.`,
          }));
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          historyRef.current = prevHistory;
          const note = errText(err);
          patchLastAssistant((m) => ({
            ...m,
            error: true,
            text: m.text ? `${m.text}\n\n⚠ ${note}` : note,
          }));
        }
      } finally {
        if (stateId !== undefined) endAlfaRunState(stateId, ctrl.signal.aborted ? "stopped" : runOk ? "done" : "failed");
        finishAlfaRun(runId, ctrl.signal.aborted ? "cancelled" : runOk ? "completed" : "failed");
        if (abortRef.current === ctrl) abortRef.current = null;
        setMessages((prev) => {
          const cleaned = prev.filter((m) => !(m.role === "assistant" && !m.text && !m.reasoning));
          persist(cleaned);
          return cleaned;
        });
      }
    },
    [tools, invoke, api.mode, persist, recordUsage, setMessages, historyRef],
  );

  const retryLast = useCallback(() => {
    if (streaming) return;
    const rewound = rewindToUserTurn(messagesRef.current, historyRef.current);
    if (!rewound) return;
    historyRef.current = rewound.history;
    setMessages(rewound.messages);
    void sendToAlfa(rewound.prompt, rewound.appId ? { appId: rewound.appId } : {});
  }, [streaming, setMessages, historyRef]);

  const editMessage = useCallback((id: string, nextText: string) => {
    if (streaming) return;
    const rewound = rewindToUserTurn(messagesRef.current, historyRef.current, id);
    if (!rewound) return;
    historyRef.current = rewound.history;
    setMessages(rewound.messages);
    void sendToAlfa(nextText, rewound.appId ? { appId: rewound.appId } : {});
  }, [streaming, setMessages, historyRef]);

  return { send, stop, retryLast, editMessage };
}

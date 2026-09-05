"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef, type Ref
} from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { errText } from "./error-text";
import {
  updateAlfa,
  useActiveShell,
  useAlfaMessages,
  awaitAlfaApproval,
  resolveAlfaApproval,
  clearAlfaApprovals,
  useAlfaBusy,
  sendToAlfa,
  ChatComposer,
  type AlfaMessage
} from "@/features/appshell";
import { runToolAgent, useOsApi, type AgentMsg } from "../lib/host";
import type { Agent, Automation } from "../lib/types";
import { activeAgent } from "../lib/store";
import { composeSystem } from "../lib/agent-request";
import { composeAutomationRequest } from "../lib/automation-request";
import { useHostCommands, type HostToolUi } from "../host-tools/use-host-commands";
import { MessageBubble, type ChatMessage, type ToolCard } from "@/features/appshell";
import { ApprovalCard } from "@/features/appshell";

import { EmptyState } from "./empty-state";
import { useThreadPersistence } from "./use-thread-persistence";
import { useAlfaRunner } from "./use-alfa-runner";
import { beginAlfaRun, finishAlfaRun } from "../lib/alfa-activity";
import { alfaProjectContext } from "@/features/appshell";

const SUGGESTED = ["Show system stats", "List ~/projects", "Create notes.txt in ~/projects with a TODO"];

let seq = 0;
const nextId = () => `m${Date.now()}-${seq++}`;

export type ChatHandle = {
  runSteps: (auto: Automation, agent?: Agent) => void;
  stop: () => void;
  loadThread: (t: { id: string; createdAt: number; messages: unknown[]; history: unknown[] }) => void;
  newThread: () => void;
};

// Alfa's chat — now a REAL host-tool agent. The model streams a turn, then any
// tool_use runs through `invoke` (host-tools binding): read tools execute
// immediately, mutate tools (fs.write/mkdir/move, exec.run) render an approval
// card and PARK the loop until the user clicks Approve/Deny. An AbortController
// threads through the loop so Stop / window-close cancels the stream and unblocks
// any pending approval. The wire history lives in `historyRef` (tool_use +
// tool_result blocks), separate from the display `messages`.
export function ChatPanel({
  agent,
  switcher,
  cockpit,
  prompts = [],
  ref,
}: {
  agent: Agent;
  switcher: React.ReactNode;
  cockpit?: React.ReactNode;
  prompts?: string[];
  ref?: Ref<ChatHandle>;
}) {
  const api = useOsApi();
  const ios = useActiveShell().id === "ios";
  // The display list lives in the SHARED Alfa store, not in this component. That
  // is what makes the per-app Alfa sheet show this very conversation instead of a
  // second, disconnected one — and it is less memory, not more: one array for
  // every surface rather than one per mounted view.
  const messages = useAlfaMessages() as ChatMessage[];
  const setMessages = useCallback(
    (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) =>
      updateAlfa((prev) =>
        (typeof next === "function" ? next(prev as ChatMessage[]) : next) as AlfaMessage[],
      ),
    [],
  );
  // No local streaming mirror. sendToAlfa sets the shared busy flag BEFORE calling
  // the registered runner, so a local copy plus an `if (streaming) return` guard in
  // send() meant every send routed through the store was silently dropped.
  const streaming = useAlfaBusy();
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const agentRef = useRef(agent);
  const historyRef = useRef<AgentMsg[]>([]);
  useEffect(() => { agentRef.current = agent; }, [agent]);

  useEffect(() => {
    // Coalesce into one rAF (streaming appends `messages` per token) and use
    // instant behavior — a smooth scroll restarted every token both janks and
    // forces a layout each frame.
    const id = requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" }));
    return () => cancelAnimationFrame(id);
  }, [messages]);

  // Stable UI seam for the tool binding: push/patch tool cards + await approval.
  const pushCard = useCallback((id: string, card: ToolCard) => {
    setMessages((prev) => [...prev, { id, role: "tool", tool: card }]);
  }, [setMessages]);
  const updateCard = useCallback((id: string, patch: Partial<ToolCard>) => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.tool ? { ...m, tool: { ...m.tool, ...patch } } : m)));
  }, [setMessages]);
  // Shared rendezvous: any surface showing the card can answer it, including the
  // mobile sheet where this panel is not even mounted.
  const requestApproval = useCallback((id: string) => awaitAlfaApproval(id), []);
  const ui = useMemo<HostToolUi>(() => ({ pushCard, updateCard, requestApproval }), [pushCard, updateCard, requestApproval]);
  const { tools, invoke } = useHostCommands(ui);

  const resolve = useCallback((id: string, approve: boolean, remember: boolean) => {
    resolveAlfaApproval(id, approve, remember);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearAlfaApprovals(); // unblock parked calls so the loop unwinds cleanly
  }, []);

  // Abort the in-flight run if the panel unmounts (window close / app swap).
  useEffect(() => () => abortRef.current?.abort(), []);

  // Thread persistence: save the conversation to a YAML thread + resume one.
  const { persist, loadThread, newThread } = useThreadPersistence(historyRef, setMessages, stop);

  const send = useCallback(
    async (text: string, fromAppId?: string) => {
      // Read FRESH, never from a ref. sendToAlfa can invoke the engine
      // synchronously in the same tick as an @mention switches the agent, so a ref
      // would still hold the previous one and the first turn after a switch would
      // carry the wrong persona.
      const a = activeAgent();
      // `appId` tags the turn with the app it came from — that tag is the whole
      // cross-feature trail the sheet renders ("in Camoufox", "in Files").
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text, appId: fromAppId },
        { id: nextId(), role: "assistant", text: "", appId: fromAppId },
      ]);
      historyRef.current.push({ role: "user", text });

      const appendToLastAssistant = (fn: (t: string) => string) =>
        setMessages((prev) => {
          const next = [...prev];
          for (let k = next.length - 1; k >= 0; k--) {
            if (next[k].role === "assistant") { next[k] = { ...next[k], text: fn(next[k].text ?? "") }; break; }
          }
          return next;
        });

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const modeNote =
        api.mode === "live"
          ? " You are in LIVE mode on a production VPS; tool actions are real."
          : " You are in MOCK mode: fs, exec and sys tools are simulated (no real VPS). The skills.* and memory.* tools are NOT simulated — they read and write real host state even here.";
      const runId = beginAlfaRun(text);
      let runOk = false;
      try {
        const { history: next } = await runToolAgent(
          historyRef.current,
          tools,
          invoke,
          {
            onDelta: (c) => appendToLastAssistant((t) => t + c),
            // After each tool card, open a fresh assistant bubble so the next
            // turn's text streams BELOW the card rather than into an earlier one.
            onTool: () => setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: "" }]),
          },
          8,
          // The persona belongs HERE, rebuilt every turn, not smuggled into history
          // as a fake user message injected once when the thread was empty. That old
          // shape is why switching agent mid-thread changed nothing: the first
          // agent's persona was frozen into turn zero forever.
          composeSystem(a, modeNote, alfaProjectContext()),
          ctrl.signal,
        );
        historyRef.current = next;
        runOk = true;
      } catch (err) {
        if (!ctrl.signal.aborted) {
          const note = errText(err);
          appendToLastAssistant((t) => (t ? `${t}\n\n⚠ ${note}` : note));
        }
      } finally {
        finishAlfaRun(runId, ctrl.signal.aborted ? "cancelled" : runOk ? "completed" : "failed");
        if (abortRef.current === ctrl) abortRef.current = null;
        // Drop the empty streaming placeholders (model ended on a tool / no text),
        // then persist the finished turn to its thread.
        setMessages((prev) => {
          const cleaned = prev.filter((m) => !(m.role === "assistant" && !m.text));
          persist(cleaned);
          return cleaned;
        });
      }
    },
    [tools, invoke, api.mode, persist, setMessages],
  );

  useAlfaRunner(send, stop);

  // Browser-local automations are execution recipes, not a second executor. One
  // click feeds their exact ordered tool intent back through Alfa's normal agent
  // loop, so reads use the same host bindings and every mutation still parks on
  // the same approval card. This keeps automation safety DRY with ordinary chat.
  useImperativeHandle(ref, () => ({
    runSteps(auto, runAgent) {
      void sendToAlfa(composeAutomationRequest(auto, (runAgent ?? agentRef.current).name));
    },
    stop,
    loadThread,
    newThread,
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card/40 px-3 py-2 [scrollbar-width:none]">
        {switcher}
      </div>
      {cockpit}
      <div
        className={cn(
          "px-3 py-1 text-center text-[11px] font-medium",
          api.mode === "live" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        {api.mode === "live"
          ? "● LIVE — Alfa acts on your real VPS; every change needs your approval"
          : "MOCK — actions are simulated (switch to Live in Settings → Server)"}
      </div>
      {messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto">
          <EmptyState prompts={[...new Set([...prompts, ...SUGGESTED])].slice(0, 6)} onPick={(t) => void sendToAlfa(t)} />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className={cn("flex flex-col p-4", ios ? "gap-1.5" : "gap-4")}>
            {messages.map((m) =>
              m.role === "tool" ? (
                <ApprovalCard key={m.id} message={m} onResolve={resolve} />
              ) : (
                <MessageBubble key={m.id} message={m} ios={ios} />
              ),
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}
      {/* Through sendToAlfa, not send(): one entry point means one single-flight
          guard and one busy flag for every surface. */}
      <ChatComposer onSend={(t) => void sendToAlfa(t)} streaming={streaming} onStop={stop} />
    </div>
  );
}

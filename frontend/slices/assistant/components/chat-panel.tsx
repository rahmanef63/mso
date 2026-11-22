"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useActiveShell } from "@/features/appshell";
import {
  updateAlfa, useAlfaMessages, resolveAlfaApproval, useAlfaBusy, sendToAlfa,
  ChatComposer, type AlfaMessage, AlfaRunProgress, AlfaApprovalGrants,
  type ChatMessage, useChatAutoScroll, ScrollToBottomButton,
} from "@/features/appshell/alfa";
import { useOsApi, type AgentMsg } from "../lib/host";
import type { Agent, Automation } from "../lib/types";
import { composeAutomationRequest } from "../lib/automation-request";
import { ChatTranscript } from "./chat-transcript";
import { TurnUsage } from "./turn-usage";
import { useTurnUsage } from "./use-turn-usage";
import { EmptyState } from "./empty-state";
import { useThreadPersistence } from "./use-thread-persistence";
import { useAlfaRunner } from "./use-alfa-runner";
import { useChatEngine } from "./use-chat-engine";

const SUGGESTED = ["Show system stats", "List ~/projects", "Create notes.txt in ~/projects with a TODO"];

export type ChatHandle = {
  runSteps: (auto: Automation, agent?: Agent) => void;
  stop: () => void;
  loadThread: (t: { id: string; createdAt: number; messages: unknown[]; history: unknown[] }) => void;
  newThread: () => void;
};

export function ChatPanel({
  agent,
  switcher,
  cockpit,
  prompts = [],
  onActiveThreadChange,
  ref,
}: {
  agent: Agent;
  switcher: React.ReactNode;
  cockpit?: React.ReactNode;
  prompts?: string[];
  onActiveThreadChange?: (id: string | null) => void;
  ref?: Ref<ChatHandle>;
}) {
  const api = useOsApi();
  const ios = useActiveShell().id === "ios";
  const messages = useAlfaMessages() as ChatMessage[];
  const setMessages = useCallback(
    (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) =>
      updateAlfa((prev) =>
        (typeof next === "function" ? next(prev as ChatMessage[]) : next) as AlfaMessage[],
      ),
    [],
  );
  const streaming = useAlfaBusy();
  const { turnUsage, threadUsage, record, reset } = useTurnUsage();
  const { containerRef, bottomRef, showScrollDown, scrollToBottom } = useChatAutoScroll(messages);
  const agentRef = useRef(agent);
  const historyRef = useRef<AgentMsg[]>([]);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => { agentRef.current = agent; }, [agent]);

  const stopProxy = useCallback(() => stopRef.current(), []);
  const { activeThreadId, persist, loadThread, newThread } = useThreadPersistence(historyRef, setMessages, stopProxy);
  const { send, stop, retryLast, editMessage } = useChatEngine({
    messages,
    setMessages,
    historyRef,
    streaming,
    persist,
    recordUsage: record,
  });
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useEffect(() => { onActiveThreadChange?.(activeThreadId); }, [activeThreadId, onActiveThreadChange]);

  useAlfaRunner(send, stop);

  useImperativeHandle(ref, () => ({
    runSteps: (auto, runAgent) => void sendToAlfa(composeAutomationRequest(auto, (runAgent ?? agentRef.current).name)),
    stop,
    loadThread: (t) => { reset(); loadThread(t); },
    newThread: () => { reset(); newThread(); },
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card/40 px-3 py-2 [scrollbar-width:none]">
        {switcher}
      </div>
      {cockpit}
      <AlfaRunProgress />
      <AlfaApprovalGrants />
      <div
        className={cn(
          "px-3 py-1 text-center text-[11px] font-medium",
          api.mode === "live" ? "bg-destructive/10 text-destructive" : "bg-muted/70 text-muted-foreground",
        )}
      >
        {api.mode === "live"
          ? "LIVE mode: actions run on your VPS and mutations require approval"
          : "MOCK mode: actions are simulated (switch to Live in Settings > Server)"}
      </div>
      {messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto">
          <EmptyState prompts={[...new Set([...prompts, ...SUGGESTED])].slice(0, 6)} onPick={(t) => void sendToAlfa(t)} />
        </div>
      ) : (
        <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div
              data-native-context-menu
              onContextMenu={(e) => e.stopPropagation()}
              className={cn("mx-auto flex w-full max-w-3xl flex-col px-4 py-4", ios ? "gap-2" : "gap-5")}
            >
              <ChatTranscript
                messages={messages}
                ios={ios}
                streaming={streaming}
                onResolve={(id, approve, remember) => resolveAlfaApproval(id, approve, remember)}
                onRetry={retryLast}
                onEdit={editMessage}
              />
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
          <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />
        </div>
      )}
      <TurnUsage turnUsage={messages.length > 0 ? turnUsage : null} threadTotal={messages.length > 0 ? threadUsage : null} />
      <div className="mx-auto w-full max-w-3xl">
        <ChatComposer onSend={(t) => void sendToAlfa(t)} streaming={streaming} onStop={stop} />
      </div>
    </div>
  );
}

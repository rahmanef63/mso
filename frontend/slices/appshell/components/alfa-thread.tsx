"use client";

import { Brain, FolderGit2, ShieldCheck, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAlfaBusy, useAlfaMessages, sendToAlfa, alfaReady, stopAlfa, type AlfaContext } from "../lib/alfa";
import { useApps } from "../lib/registry";
import { openWindow } from "../lib/store";
import { ChatComposer } from "./chat-composer";
import { AlfaRunProgress } from "./alfa-run-progress";
import { AlfaApprovalGrants } from "./alfa-approval-grants";
import { ApprovalCard } from "./approval-card";
import { ChatMarkdown } from "./chat-markdown";
import { ScrollToBottomButton, useChatAutoScroll } from "./use-chat-autoscroll";
import type { ToolCard } from "./message-bubble";
import { CopyButton } from "./copy-button";
import { resolveAlfaApproval, useAlfaApprovalCount } from "../lib/alfa-approvals";
import { useAlfaProjectContext } from "../lib/alfa-work-context";

function legacyMessageTime(id: string): number | undefined {
  const match = /^m(\d+)-/.exec(id);
  return match ? Number(match[1]) : undefined;
}

export function AlfaThread({ ctx, placeholder }: { ctx: AlfaContext; placeholder?: string }) {
  const messages = useAlfaMessages();
  const busy = useAlfaBusy();
  const apps = useApps();
  const { containerRef, bottomRef, showScrollDown, scrollToBottom } = useChatAutoScroll(messages);
  const project = useAlfaProjectContext();
  const approvals = useAlfaApprovalCount();

  const titleOf = (id?: string) => apps.find((a) => a.id === id)?.title ?? id;

  async function submit(text: string) {
    const body = text.trim();
    if (!body || busy) return;
    if (alfaReady()) { await sendToAlfa(body, ctx); return; }
    openWindow("assistant", "Alfa");
    for (let i = 0; i < 40 && !alfaReady(); i++) await new Promise((r) => setTimeout(r, 50));
    await sendToAlfa(body, ctx);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AlfaRunProgress />
      <AlfaApprovalGrants />
      {project || approvals ? (
        <button
          type="button"
          className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border/70 px-3 text-left text-[10px] text-muted-foreground hover:bg-secondary/40"
          onClick={() => openWindow("assistant", "Alfa")}
        >
          {project ? <><FolderGit2 className="size-3.5" /><span className="max-w-[55%] truncate font-medium text-foreground">{project.name}</span>{project.branch ? <span className="truncate">· {project.branch}</span> : null}</> : null}
          <span className="flex-1" />
          {approvals ? <span className="flex items-center gap-1 text-warning"><ShieldCheck className="size-3.5" />{approvals} pending</span> : null}
        </button>
      ) : null}
      <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2.5 p-3">
            {messages.length === 0 ? (
              <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                {ctx.subject ? (
                  <>
                    Ask Alfa about <strong>{ctx.subject}</strong>. She sees this app&apos;s state, and
                    this is the same conversation as the Assistant app.
                  </>
                ) : (
                  "Ask Alfa anything about this machine."
                )}
              </p>
            ) : null}

            {messages.map((m, i) => {
              const prev = i > 0 ? messages[i - 1].appId : undefined;
              const crossed = m.appId && m.appId !== prev;
              const createdAt = m.createdAt || legacyMessageTime(m.id);
              const dateLabel = createdAt ? new Date(createdAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : null;
              const previousCreatedAt = i > 0 ? (messages[i - 1].createdAt || legacyMessageTime(messages[i - 1].id)) : undefined;
              const newDay = Boolean(dateLabel && (!previousCreatedAt || new Date(createdAt!).toLocaleDateString() !== new Date(previousCreatedAt).toLocaleDateString()));
              const time = createdAt ? new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
              const isLast = i === messages.length - 1;
              return (
                <div key={m.id} className="contents">
                  {newDay ? (
                    <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      <span>{dateLabel}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}
                  {crossed ? (
                    <div className="flex items-center gap-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      <Sparkles className="size-3" aria-hidden />
                      <span>in {titleOf(m.appId)}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}
                  {m.role === "tool" && m.tool ? (
                    <ApprovalCard
                      message={{ id: m.id, role: "tool", tool: m.tool as ToolCard }}
                      onResolve={resolveAlfaApproval}
                    />
                  ) : (
                    <div className={cn("min-w-0", m.role === "user" ? "max-w-[90%] self-end" : "w-full self-start")}>
                      <div
                        onContextMenu={(e) => e.stopPropagation()}
                        className={cn(
                          "select-text [user-select:text] [-webkit-user-select:text] [-webkit-touch-callout:default] min-w-0 break-words [overflow-wrap:anywhere] text-xs leading-relaxed",
                          m.role === "user"
                            ? "whitespace-pre-wrap rounded-xl bg-primary px-2.5 py-1.5 text-primary-foreground"
                            : m.error
                              ? "rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-foreground"
                              : "rounded-lg bg-secondary/70 px-2.5 py-1.5 text-secondary-foreground",
                        )}
                      >
                        {m.role === "assistant" && m.reasoning ? (
                          <details className="mb-1.5 rounded border border-border/60 bg-background/50 px-2 py-1 text-[11px] text-muted-foreground">
                            <summary className="flex cursor-pointer items-center gap-1 font-medium">
                              <Brain className="size-3 shrink-0" aria-hidden />
                              {busy && isLast && !m.text ? "Thinking..." : "Thought process"}
                            </summary>
                            <p className="mt-1 whitespace-pre-wrap">{m.reasoning}</p>
                          </details>
                        ) : null}
                        {!m.text ? (
                          <span className="inline-flex items-center gap-1 py-0.5 text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:150ms]" />
                            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:300ms]" />
                          </span>
                        ) : m.role === "user" ? (
                          m.text
                        ) : (
                          <ChatMarkdown text={m.text} />
                        )}
                      </div>
                      {m.text ? (
                        <div className={cn("mt-0.5 flex items-center gap-1.5", m.role === "user" ? "justify-end" : "justify-start")}>
                          {time ? <span className="flex h-7 items-center text-[10px] leading-none text-muted-foreground [@media(pointer:coarse)]:h-11">{time}</span> : null}
                          <CopyButton value={m.text} label="message" className="size-7 [@media(pointer:coarse)]:size-11" />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
        <ScrollToBottomButton visible={showScrollDown} onClick={scrollToBottom} />
      </div>

      <ChatComposer
        onSend={(text) => void submit(text)}
        streaming={busy}
        onStop={stopAlfa}
        placeholder={placeholder}
      />
    </div>
  );
}

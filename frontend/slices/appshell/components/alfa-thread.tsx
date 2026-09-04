"use client";

import { useEffect, useRef } from "react";
import { FolderGit2, ShieldCheck, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAlfaBusy, useAlfaMessages, sendToAlfa, alfaReady, stopAlfa, type AlfaContext } from "../lib/alfa";
import { useApps } from "../lib/registry";
import { openWindow } from "../lib/store";
import { ChatComposer } from "./chat-composer";
import { ApprovalCard } from "./approval-card";
import type { ToolCard } from "./message-bubble";
import { resolveAlfaApproval, useAlfaApprovalCount } from "../lib/alfa-approvals";
import { useAlfaProjectContext } from "../lib/alfa-work-context";

// The Alfa conversation, rendered wherever it is needed — the desktop right dock,
// the mobile sheet, anywhere else later. It owns NO conversation state: everything
// comes from the shared store, so the same exchange is on screen in every surface
// that happens to be open, and switching apps no longer wipes it.
//
// The cross-feature trail is the point of the appId tag: when consecutive turns
// happened in different apps a divider names the new one, so a long task Alfa
// carried from Files to Terminal to the Browser reads as one story instead of
// three disconnected chats.
export function AlfaThread({ ctx, placeholder }: { ctx: AlfaContext; placeholder?: string }) {
  const messages = useAlfaMessages();
  const busy = useAlfaBusy();
  const apps = useApps();
  const bottom = useRef<HTMLDivElement>(null);
  const project = useAlfaProjectContext();
  const approvals = useAlfaApprovalCount();

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const titleOf = (id?: string) => apps.find((a) => a.id === id)?.title ?? id;

  // The engine lives in the Assistant app (it owns the tool binding and the
  // approval cards). If it is not mounted yet, open it and send once it registers
  // — the user sees Alfa's own window appear and their message land in it, which
  // is the same "watch it move between features" story, not an error.
  async function submit(text: string) {
    const body = text.trim();
    if (!body || busy) return;
    if (await sendToAlfa(body, ctx)) return;
    openWindow("assistant", "Alfa");
    // The panel registers on mount; poll briefly rather than wiring a bespoke
    // ready-event for a path that resolves in one or two frames.
    for (let i = 0; i < 40 && !alfaReady(); i++) await new Promise((r) => setTimeout(r, 50));
    await sendToAlfa(body, ctx);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2.5 p-3">
          {messages.length === 0 ? (
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              {ctx.subject ? (
                <>
                  Ask Alfa about <strong>{ctx.subject}</strong>. She sees this app&apos;s state — and
                  this is the same conversation as the Assistant app.
                </>
              ) : (
                "Ask Alfa anything about this machine."
              )}
            </p>
          ) : null}

          {messages.map((m, i) => {
            // Only when the app actually changes between consecutive turns.
            const prev = i > 0 ? messages[i - 1].appId : undefined;
            const crossed = m.appId && m.appId !== prev;
            return (
              <div key={m.id} className="contents">
                {crossed ? (
                  <div className="flex items-center gap-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    <Sparkles className="size-3" aria-hidden />
                    <span>in {titleOf(m.appId)}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                {m.role === "tool" && m.tool ? (
                  // A parked mutate call renders its Approve/Deny here too — before
                  // this the sheet showed a bare "…" and the agent loop hung with no
                  // control anywhere on screen.
                  <ApprovalCard
                    message={{ id: m.id, role: "tool", tool: m.tool as ToolCard }}
                    onResolve={resolveAlfaApproval}
                  />
                ) : (
                  <div
                    className={cn(
                      "max-w-[92%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed",
                      m.role === "user"
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-secondary text-secondary-foreground",
                    )}
                  >
                    {m.text || "…"}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </ScrollArea>

      {/* THE composer — the same component the Assistant app renders, so @ and /
          and Enter-to-send behave identically in the dock, the sheet and the app. */}
      <ChatComposer
        onSend={(text) => void submit(text)}
        streaming={busy}
        onStop={stopAlfa}
        placeholder={placeholder}
      />
    </div>
  );
}

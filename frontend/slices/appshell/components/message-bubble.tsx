"use client";

import { memo, useState } from "react";
import { Brain, ChevronDown, ChevronRight, Pencil, RotateCcw, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "./chat-markdown";
import { CopyButton } from "./copy-button";

export type ChatRole = "user" | "assistant" | "tool";

export type ToolStatus = "pending" | "running" | "ok" | "error" | "denied";

export type ToolCard = {
  name: string;
  effect: "read" | "mutate";
  input: Record<string, unknown>;
  status: ToolStatus;
  result?: string;
  danger?: string;
  approvalScope?: string;
};

export type ChatMessage = {
  id: string;
  createdAt?: number;
  role: ChatRole;
  text?: string;
  reasoning?: string;
  error?: boolean;
  tool?: ToolCard;
};

function legacyMessageTime(id: string): number | undefined {
  const match = /^m(\d+)-/.exec(id);
  return match ? Number(match[1]) : undefined;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1 text-muted-foreground" aria-label="Generating response">
      <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:300ms]" />
    </span>
  );
}

function ReasoningBlock({ reasoning, thinking }: { reasoning: string; thinking: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? thinking;
  return (
    <div className="mb-2 rounded-lg border border-border/70 bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-10"
      >
        {expanded ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
        <Brain className={cn("size-3.5 shrink-0", thinking && "text-primary motion-safe:animate-pulse")} aria-hidden />
        <span className="font-medium">{thinking ? "Thinking..." : "Thought process"}</span>
      </button>
      {expanded ? (
        <div className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words border-t border-border/60 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {reasoning}
        </div>
      ) : null}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  ios,
  isStreaming,
  isLastAssistant,
  onRetry,
  onEdit,
}: {
  message: ChatMessage;
  ios?: boolean;
  isStreaming?: boolean;
  isLastAssistant?: boolean;
  onRetry?: () => void;
  onEdit?: (id: string, nextText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const createdAt = message.createdAt || legacyMessageTime(message.id);
  const time = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const isUser = message.role === "user";
  const thinking = Boolean(isStreaming && message.reasoning && !message.text);

  function startEdit() {
    setDraft(message.text ?? "");
    setEditing(true);
  }

  function commitEdit() {
    const clean = draft.trim();
    if (!clean || !onEdit) return;
    setEditing(false);
    onEdit(message.id, clean);
  }

  return (
    <div className="contents">
      <div className={cn("group flex w-full min-w-0 items-start gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
        {!ios && (
          <span
            className={cn(
              "mt-0.5 grid size-7 flex-none place-items-center rounded-full",
              isUser ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground",
            )}
          >
            {isUser ? <User className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          </span>
        )}
        <div className={cn("min-w-0", isUser ? (ios ? "max-w-[78%]" : "max-w-[82%]") : ios ? "max-w-[82%]" : "flex-1")}>
          {editing ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-2.5">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    commitEdit();
                  }
                }}
                rows={2}
                autoFocus
                aria-label="Edit message"
                className="min-h-14 resize-none text-sm"
              />
              <div className="flex justify-end gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="button" size="sm" disabled={!draft.trim()} onClick={commitEdit}>Save and send</Button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "select-text [user-select:text] [-webkit-user-select:text] [-webkit-touch-callout:default] min-w-0 break-words [overflow-wrap:anywhere]",
                ios
                  ? cn(
                      "rounded-[19px] px-[13px] py-2 text-[15px] leading-[1.35]",
                      isUser
                        ? "whitespace-pre-wrap rounded-br-[6px] bg-primary text-primary-foreground"
                        : message.error
                          ? "rounded-bl-[6px] border border-destructive/40 bg-destructive/10 text-foreground"
                          : "rounded-bl-[6px] bg-[var(--fill2)] text-foreground",
                    )
                  : isUser
                    ? "whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground"
                    : cn(
                        "text-sm leading-relaxed text-foreground",
                        message.error && "rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5",
                      ),
              )}
            >
              {!isUser && message.reasoning ? <ReasoningBlock reasoning={message.reasoning} thinking={thinking} /> : null}
              {!message.text ? (
                !thinking ? <TypingDots /> : null
              ) : isUser ? (
                message.text
              ) : (
                <ChatMarkdown text={message.text} />
              )}
            </div>
          )}

          {!editing && message.text ? (
            <div className={cn("mt-1 flex items-center gap-0.5", isUser ? "justify-end" : "justify-start")}>
              {time ? <span className="flex h-7 items-center px-1 text-[10px] leading-none text-muted-foreground [@media(pointer:coarse)]:h-11">{time}</span> : null}
              <CopyButton value={message.text} label="message" className="size-7 [@media(pointer:coarse)]:size-11" />
              {isUser && onEdit && !isStreaming ? (
                <Button type="button" variant="ghost" size="icon" onClick={startEdit} aria-label="Edit message" title="Edit and resend" className="size-7 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11">
                  <Pencil className="size-3.5" />
                </Button>
              ) : null}
              {!isUser && (isLastAssistant || message.error) && onRetry && !isStreaming ? (
                <Button
                  type="button"
                  variant="ghost"
                  size={message.error ? "sm" : "icon"}
                  onClick={onRetry}
                  aria-label={message.error ? "Retry response" : "Regenerate response"}
                  title={message.error ? "Retry" : "Regenerate"}
                  className={cn(
                    "shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11",
                    message.error ? "h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive" : "size-7 [@media(pointer:coarse)]:size-11",
                  )}
                >
                  <RotateCcw className="size-3.5" />
                  {message.error ? <span>Retry</span> : null}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

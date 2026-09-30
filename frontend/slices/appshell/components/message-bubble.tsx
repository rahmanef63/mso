"use client";

import { Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { mdToHtml } from "../features/widgets/components/md";

export type ChatRole = "user" | "assistant" | "tool";

export type ToolStatus = "pending" | "running" | "ok" | "error" | "denied";

// A host tool call surfaced in the transcript (rendered by ApprovalCard, not
// MessageBubble). `danger` is the advisory destructive-pattern reason (exec.run).
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
  role: ChatRole;
  text?: string;
  /** Present only on `role: "tool"` rows. */
  tool?: ToolCard;
};

// One chat row: user messages align right (primary bubble), assistant messages
// align left with a Sparkles avatar. Tool rows are routed to ApprovalCard by the
// chat panel, so this only renders user/assistant. All colour via theme tokens.
export function MessageBubble({ message, ios }: { message: ChatMessage; ios?: boolean }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex w-full items-start gap-2.5",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* iMessage shows no per-bubble avatar in the thread — keep it off on iOS. */}
      {!ios && (
        <span
          className={cn(
            "mt-0.5 grid size-7 flex-none place-items-center rounded-full",
            isUser
              ? "bg-secondary text-secondary-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </span>
      )}
      <div
        className={cn(
          "whitespace-pre-wrap",
          // iOS = iMessage silhouette: 19px bubble with the tail at the BOTTOM
          // corner (points down at the sender); received bubble = systemFill gray.
          ios
            ? cn(
                "max-w-[74%] rounded-[19px] px-[13px] py-2 text-[15px] leading-[1.35]",
                isUser ? "rounded-br-[6px] bg-primary text-primary-foreground" : "rounded-bl-[6px] bg-[var(--fill2)] text-foreground",
              )
            : cn(
                "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                isUser ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted text-foreground",
              ),
        )}
      >
        {!message.text ? (
          <span className="text-muted-foreground">…</span>
        ) : isUser ? (
          message.text
        ) : (
          // Assistant text is MARKDOWN. The model emits **bold**, `code`, bullets
          // and fenced blocks on nearly every turn, and rendering it literally is
          // why the thread read as unfinished — a wall of asterisks and backticks.
          // mdToHtml escapes first and emits a fixed tag set (see md.test.ts),
          // which is what makes dangerouslySetInnerHTML defensible on text that is
          // model output, i.e. untrusted.
          // USER text stays literal on purpose: someone typing ** means **.
          // whitespace-normal because mdToHtml already turned newlines into <br/>;
          // leaving the parent's pre-wrap on would double every line break.
          <span
            className="block whitespace-normal [&_code]:font-mono [&_pre]:whitespace-pre [&_strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: mdToHtml(message.text) }}
          />
        )}
      </div>
    </div>
  );
}

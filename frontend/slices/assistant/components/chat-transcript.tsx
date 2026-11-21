"use client";

import { ApprovalCard, MessageBubble, type ChatMessage } from "@/features/appshell/alfa";

function legacyMessageTime(id: string): number | undefined {
  const match = /^m(\d+)-/.exec(id);
  return match ? Number(match[1]) : undefined;
}

export function ChatTranscript({
  messages,
  ios,
  streaming,
  onResolve,
  onRetry,
  onEdit,
}: {
  messages: ChatMessage[];
  ios: boolean;
  streaming?: boolean;
  onResolve: (id: string, approve: boolean, remember: boolean) => void;
  onRetry?: () => void;
  onEdit?: (id: string, nextText: string) => void;
}) {
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  return (
    <>
      {messages.map((m, i) => {
        const currentTime = m.createdAt || legacyMessageTime(m.id);
        const previousTime = i > 0 ? (messages[i - 1].createdAt || legacyMessageTime(messages[i - 1].id)) : undefined;
        const showDateSeparator = Boolean(
          currentTime &&
            (!previousTime ||
              new Date(currentTime).toLocaleDateString() !== new Date(previousTime).toLocaleDateString()),
        );
        const isLastAssistant = i === lastAssistantIndex;
        return (
          <div key={m.id} className="contents">
            {showDateSeparator ? (
              <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>{new Date(currentTime!).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            {m.role === "tool" ? (
              <ApprovalCard message={m} onResolve={onResolve} />
            ) : (
              <MessageBubble
                message={m}
                ios={ios}
                isStreaming={Boolean(streaming && isLastAssistant)}
                isLastAssistant={isLastAssistant}
                onRetry={onRetry}
                onEdit={onEdit}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

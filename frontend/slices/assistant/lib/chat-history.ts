import type { AgentMsg } from "./host";
import type { ChatMessage } from "@/features/appshell/alfa";

export type RewindResult = {
  messages: ChatMessage[];
  history: AgentMsg[];
  prompt: string;
  appId?: string;
};

/**
 * Rewind display messages and wire history back to before the target user turn
 * (for Edit & Resend) or before the last user turn (for Regenerate / Retry).
 * Matches user turns by ordinal index so tool cards and multi-bubble turns never
 * drift out of sync with `historyRef`.
 */
export function rewindToUserTurn(
  messages: ChatMessage[],
  history: AgentMsg[],
  targetUserMsgId?: string,
): RewindResult | null {
  const userDisplayIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") userDisplayIndices.push(i);
  }
  if (userDisplayIndices.length === 0) return null;

  let ordinal = userDisplayIndices.length - 1;
  if (targetUserMsgId) {
    ordinal = userDisplayIndices.findIndex((idx) => messages[idx].id === targetUserMsgId);
    if (ordinal < 0) return null;
  }

  const displayCut = userDisplayIndices[ordinal];
  const targetMsg = messages[displayCut];
  const prompt = (targetMsg.text ?? "").trim();
  if (!prompt) return null;

  // Locate the matching Nth user entry in wire history.
  let seenUsers = 0;
  let historyCut = history.length;
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === "user") {
      if (seenUsers === ordinal) {
        historyCut = i;
        break;
      }
      seenUsers++;
    }
  }

  return {
    messages: messages.slice(0, displayCut),
    history: history.slice(0, historyCut),
    prompt,
    appId: (targetMsg as { appId?: string }).appId,
  };
}

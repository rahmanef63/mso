import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/features/appshell/alfa";
import type { AgentMsg } from "./host";
import { rewindToUserTurn } from "./chat-history";

describe("rewindToUserTurn", () => {
  const messages: ChatMessage[] = [
    { id: "u1", role: "user", text: "first question" },
    { id: "t1", role: "tool", tool: { name: "fs.list", effect: "read", input: {}, status: "ok", result: "a.txt" } },
    { id: "a1", role: "assistant", text: "first answer" },
    { id: "u2", role: "user", text: "second question" },
    { id: "a2", role: "assistant", text: "error reply", error: true },
  ];
  const history: AgentMsg[] = [
    { role: "user", text: "first question" },
    { role: "assistant", text: "", toolUses: [{ id: "tc1", name: "fs.list", input: {} }] },
    { role: "tool", results: [{ id: "tc1", content: "a.txt" }] },
    { role: "assistant", text: "first answer" },
    { role: "user", text: "second question" },
    { role: "assistant", text: "second answer" },
  ];

  it("rewinds to the last user turn for regenerate/retry", () => {
    const res = rewindToUserTurn(messages, history);
    expect(res).not.toBeNull();
    expect(res!.prompt).toBe("second question");
    expect(res!.messages.map((m) => m.id)).toEqual(["u1", "t1", "a1"]);
    expect(res!.history).toHaveLength(4);
    expect(res!.history.at(-1)).toEqual({ role: "assistant", text: "first answer" });
  });

  it("rewinds cleanly when wire history was already rolled back on error", () => {
    const rolledBackHistory = history.slice(0, 4);
    const res = rewindToUserTurn(messages, rolledBackHistory);
    expect(res!.prompt).toBe("second question");
    expect(res!.messages.map((m) => m.id)).toEqual(["u1", "t1", "a1"]);
    expect(res!.history).toHaveLength(4);
  });

  it("rewinds to an earlier user message by id for edit-and-resend", () => {
    const res = rewindToUserTurn(messages, history, "u1");
    expect(res).not.toBeNull();
    expect(res!.prompt).toBe("first question");
    expect(res!.messages).toEqual([]);
    expect(res!.history).toEqual([]);
  });

  it("returns null when no matching user turn exists", () => {
    expect(rewindToUserTurn([], [])).toBeNull();
    expect(rewindToUserTurn(messages, history, "missing")).toBeNull();
  });
});

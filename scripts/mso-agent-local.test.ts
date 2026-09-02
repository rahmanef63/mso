import { describe, expect, it } from "vitest";
import { modelHistoryRow } from "./mso-agent-context.mjs";
import { LocalAgentBridge, formatLocalAgentEvent, localAgentPresentation } from "./mso-agent-local.mjs";

const plain = { c: "", bold: "", reset: "", dim: "", blue: "", cyan: "", warn: "", err: "" };

describe("local agent TUI projection", () => {
  it("renders manual and placeholder senders as agent-origin events", () => {
    expect(formatLocalAgentEvent({ senderLabel: "[zahra]", kind: "message", text: "hi" }, plain)).toBe("[agent-zahra] hi");
    expect(formatLocalAgentEvent({ senderLabel: "[agent-b]", kind: "task", text: "review" }, plain)).toBe("[agent-b] task review");
  });

  it("stores agent as a distinct role and labels peer content as data for the model", () => {
    expect(modelHistoryRow({ role: "agent", senderLabel: "[zahra]", kind: "task", text: "review" })).toEqual({
      role: "user",
      text: "[LOCAL_AGENT_DATA [zahra] · task · notify] review",
    });
  });

  it("relays only an explicitly correlated reply to a tracked user request", () => {
    const history = [{ role: "local_request", messageId: "localmsg_req", correlationId: "localcorr_x", requiresUserRelay: true }];
    const reply = { senderLabel: "[agent-b]", kind: "message", intent: "reply", text: "piano", replyToMessageId: "localmsg_req", correlationId: "localcorr_x", requiresUserRelay: true };
    expect(localAgentPresentation(history, reply, plain)).toMatchObject({ mode: "relay" });
    expect(localAgentPresentation(history, reply, plain).text).toContain("[agent-b] → user piano");
  });

  it("keeps notify-only and stale/mismatched replies as events without assistant relay", () => {
    const history = [{ role: "local_request", messageId: "localmsg_req", correlationId: "localcorr_new", requiresUserRelay: true }];
    expect(localAgentPresentation(history, { senderLabel: "[agent-b]", intent: "notify", text: "FYI" }, plain).mode).toBe("event");
    expect(localAgentPresentation(history, {
      senderLabel: "[agent-b]", intent: "reply", text: "old", replyToMessageId: "localmsg_old",
      correlationId: "localcorr_old", requiresUserRelay: true,
    }, plain).mode).toBe("event");
  });

  it("persists a correlated user relay as a synthetic assistant response without invoking the model", async () => {
    const history: any[] = [{ role: "local_request", messageId: "localmsg_req", correlationId: "localcorr_x", requiresUserRelay: true }];
    const notices: string[] = [];
    const bridge = new LocalAgentBridge({ session: { history, agentSession: { id: "session-a" } }, composer: { notify: (text: string) => notices.push(text) } });
    bridge.sessionId = "session-a"; bridge.ack = async () => {};
    bridge.session.history = history;
    const persistRows: any[] = [];
    // accept() persists through the real helper; the in-memory rows are enough to assert the deterministic relay contract.
    await bridge.accept({
      id: "localmsg_reply", targetSessionId: "session-a", senderLabel: "[agent-b]", senderSessionId: "session-b",
      kind: "message", intent: "reply", text: "piano", correlationId: "localcorr_x", replyToMessageId: "localmsg_req",
      requiresUserRelay: true, createdAt: new Date().toISOString(),
    }).catch(() => undefined);
    persistRows.push(...bridge.session.history);
    expect(persistRows).toEqual(expect.arrayContaining([expect.objectContaining({ role: "assistant", synthetic: "local_agent_relay", text: "[agent-b] replied: piano" })]));
    expect(localAgentPresentation(history, { senderLabel: "[agent-b]", intent: "reply", text: "piano", replyToMessageId: "localmsg_req", correlationId: "localcorr_x", requiresUserRelay: true }, plain).text).toContain("[agent-b] → user piano");
  });

  it("deduplicates a replayed SSE message id before rendering it again", async () => {
    const notices: string[] = [];
    const bridge = new LocalAgentBridge({ session: { history: [], agentSession: { id: "session-a" } }, composer: { notify: (text: string) => notices.push(text) } });
    bridge.sessionId = "session-a";
    bridge.seen.add("localmsg_dup");
    bridge.ack = async () => {};
    await bridge.accept({ id: "localmsg_dup", targetSessionId: "session-a", text: "duplicate" });
    expect(notices).toEqual([]);
  });
});

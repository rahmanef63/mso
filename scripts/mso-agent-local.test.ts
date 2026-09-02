import { describe, expect, it } from "vitest";
import { modelHistoryRow } from "./mso-agent-context.mjs";
import { formatLocalAgentEvent } from "./mso-agent-local.mjs";

const plain = { c: "", bold: "", reset: "", dim: "", blue: "", cyan: "", warn: "", err: "" };

describe("local agent TUI projection", () => {
  it("renders manual and placeholder senders as agent-origin events", () => {
    expect(formatLocalAgentEvent({ senderLabel: "[zahra]", kind: "message", text: "hi" }, plain)).toBe("[agent-zahra] hi");
    expect(formatLocalAgentEvent({ senderLabel: "[agent-b]", kind: "task", text: "review" }, plain)).toBe("[agent-b] task review");
  });

  it("stores agent as a distinct role but maps it safely to model input", () => {
    expect(modelHistoryRow({ role: "agent", senderLabel: "[zahra]", kind: "task", text: "review" })).toEqual({
      role: "user",
      text: "[LOCAL AGENT [zahra] · task] review",
    });
  });
});

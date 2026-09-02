import { describe, expect, it } from "vitest";
import { composerFooter, composerPrompt, composerSeparator, sectionBlock, sectionDivider } from "./mso-agent-layout.mjs";

const colors = { blue: "", bold: "", reset: "", dim: "", c: "", cyan: "", warn: "", err: "" };
const session = {
  permission: "ask", statusBar: true, history: [], usage: { totalTokens: 0 },
  state: { config: { provider: "openai-codex", model: "gpt-5.6-terra" }, modelMeta: { context: 128000 } },
  agentSession: { id: "session-a", name: "milo", title: "Review auth", compactThresholdTokens: 700000, estimatedTokens: 120 },
};

describe("MSO Agent sectioned terminal layout", () => {
  it("renders terminal-width dividers for assistant, work, local-agent, error, and input streams", () => {
    for (const kind of ["assistant", "work", "local", "error", "input"] as const) {
      const line = sectionDivider(kind, { columns: 60, colors });
      expect(Array.from(line)).toHaveLength(59);
      expect(line).toContain("─");
    }
    expect(sectionDivider("assistant", { columns: 60, colors })).toContain("Assistant");
    expect(sectionDivider("work", { columns: 60, colors })).toContain("Agent work");
    expect(sectionDivider("local", { columns: 60, colors })).toContain("Local agent");
  });

  it("puts the short agent handle in the composer header and permission mode only in the bottom footer", () => {
    const prompt = composerPrompt(session, colors);
    const footer = composerFooter(session, colors, 100);
    expect(prompt).toBe("@milo › ");
    expect(prompt).not.toContain("ask");
    expect(footer).toContain("mode ask");
    expect(footer).not.toContain("@milo");
  });

  it("separates the bottom input area from transcript output with a named full-width divider", () => {
    const divider = composerSeparator(session, colors, 72);
    expect(divider).toContain("Input · @milo");
    expect(Array.from(divider)).toHaveLength(71);
  });

  it("wraps local/error text as one section block without duplicating content", () => {
    const block = sectionBlock("local", "[agent-zahra] hello", { columns: 72, colors });
    expect(block.match(/Local agent/g)).toHaveLength(1);
    expect(block.match(/\[agent-zahra\] hello/g)).toHaveLength(1);
  });
});

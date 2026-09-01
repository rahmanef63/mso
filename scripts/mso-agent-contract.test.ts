import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = ["mso-agent.mjs", "mso-agent-runtime.mjs", "mso-agent-ui.mjs"].map((name) => path.join(__dirname, name));
const src = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

describe("MSO terminal agent contract", () => {
  it("renders the final blue MSO Agent title art and setup/session shortcuts", () => {
    expect(src).toContain("████████╗                   ███╗   ███╗███████╗ ██████╗ ");
    expect(src).toContain("██╔═╦═╦═╝████████████████╗  ████╗ ████║██╔════╝██╔═══██╗");
    expect(src).toContain("██║    >     _     >   ██║  ██║╚██╔╝██║╚════██║██║   ██║");
    expect(src).toContain("╚████████████████████████╝  ╚═╝     ╚═╝╚══════╝ ╚═════╝ ");
    expect(src).toContain("                    ── MSO Agent ──");
    expect(src).toContain("MSO_TITLE_ART");
    expect(src).toContain("MSO_TITLE_COLORS");
    expect(src).toContain("38;2;69;142;255");
    expect(src).toContain("38;2;46;229;157");
    expect(src).not.toContain("MSO_TITLE_GUTTER");
    expect(src).not.toContain("╭──┘      ╰────────╮");
    for (const command of ["/model", "/setup", "/providers", "/provider", "/doctor", "/tools", "/skills", "/skill", "/<skill>", "/session", "/sessions", "/resume", "/clear", "/exit"]) expect(src).toContain(command);
    expect(src).toContain("selected for the next message");
    expect(src).toContain("AgentComposer");
    expect(src).toContain("slashCompletionItems");
  });

  it("keeps infrastructure secrets out of model messages and binds write/exec approval to the exact full payload", () => {
    expect(src).toContain("never ask the user to paste API tokens into chat");
    expect(src).toContain('tool.scope === "read"');
    expect(src).toContain("exact tool call");
    expect(src).toContain("allow this exact call? [y/N]");
    expect(src).toContain("canonicalAgentApproval");
    expect(src).toContain("approvalDigest");
    expect(src).not.toContain("redactedPreview");
    expect(src).not.toContain("allowedForSession");
    expect(src).toContain("approved: true");
  });

  it("reads the authenticated cookie jar instead of accepting a bearer/token argument", () => {
    expect(src).toContain("MSO_AGENT_JAR");
    expect(src).not.toMatch(/process\.argv.*(?:token|secret|password|apiKey)/i);
  });
});

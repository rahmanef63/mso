import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = ["mso-agent.mjs", "mso-agent-runtime.mjs", "mso-agent-ui.mjs", "mso-agent-slash.mjs", "mso-agent-status.mjs", "mso-agent-sessions.mjs", "mso-agent-session-ui.mjs", "mso-agent-commands.mjs", "mso-agent-composer.mjs", "mso-agent-permissions.mjs"].map((name) => path.join(__dirname, name));
const src = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

describe("MSO terminal agent contract", () => {
  it("renders the exact hybrid MSO Agent title and keeps model/session UX discoverable", () => {
    const banner = [
      "   ████████████",
      "  ██          ██",
      "  ██   ██ ██ ██   ██████████████████████",
      "  ██                                  ██      ███╗   ███╗███████╗ ██████╗ ",
      "  ██                                  ██      ████╗ ████║██╔════╝██╔═══██╗",
      "  ██       ██                ██       ██      ██╔████╔██║███████╗██║   ██║",
      "  ██         ██                ██     ██      ██║╚██╔╝██║╚════██║██║   ██║",
      "  ██       ██    ████████    ██       ██      ██║ ╚═╝ ██║███████║╚██████╔╝",
      "  ██                                  ██      ╚═╝     ╚═╝╚══════╝ ╚═════╝ ",
      "  ██                                  ██",
      "   ████████████████████████████████████",
      "                                                       ── MSO Agent ──",
    ];
    for (const line of banner) expect(src).toContain(line);
    for (const rgb of [
      "38;2;155;81;224", "38;2;112;111;245", "38;2;69;142;255",
      "38;2;45;184;255", "38;2;34;211;206", "38;2;46;229;157",
    ]) expect(src).toContain(rgb);
    expect(src).toContain("MSO_TITLE_ART");
    expect(src).toContain("MSO_TITLE_COLORS");
    for (const command of [
      "/models", "/model", "/status", "/context", "/statusbar", "/title",
      "/session", "/resume", "/setup", "/providers", "/provider",
      "/doctor", "/tools", "/skills", "/skill", "/<skill>", "/clear", "/exit", "/quit",
    ]) expect(src).toContain(command);
    expect(src).toContain("Configure AI providers and authentication");
    expect(src).toContain("Select the active model from connected providers");
    expect(src).toContain("queued");
    expect(src).toContain("invoking");
    expect(src).toContain("lastInvokedSkill");
    expect(src).toContain("AgentComposer");
    expect(src).toContain("slashCompletionItems");
    expect(src).toContain("renderStatusBar");
    expect(src).toContain("resolveSessionQuery");
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

  it("keeps session picker titles human-first and rename explicit", () => {
    expect(src).toContain("recent sessions");
    expect(src).toContain("renameCliSession");
    expect(src).toContain('action: "rename"');
    expect(src).toContain("syncPromptHistory");
    expect(src).toContain("permissionCompletionItems");
    expect(src).toContain("approvesTool");
    expect(src).toContain("--yolo");
  });

});

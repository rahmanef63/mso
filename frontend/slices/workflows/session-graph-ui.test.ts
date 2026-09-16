import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowApp = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
const settingsSessions = readFileSync(new URL("../os-settings/components/mcp-sessions.tsx", import.meta.url), "utf8");
const settingsDetail = readFileSync(new URL("../os-settings/components/mcp-session-detail.tsx", import.meta.url), "utf8");
const sessionGuide = readFileSync(new URL("../os-settings/components/mcp-session-guide.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./components/workflow-inspector.tsx", import.meta.url), "utf8");

describe("Workflow session graph UI contract", () => {
  it("routes Settings sessions into the Workflow Sessions view and never renders the internal id", () => {
    expect(settingsSessions).toContain('openWindow("workflows", "Workflows", undefined, { view: "sessions", sessionId: id })');
    expect(settingsSessions).toContain("session.label");
    for (const source of [settingsSessions, settingsDetail, sessionGuide, inspector]) {
      expect(source).not.toContain('label="Session ID"');
      expect(source).not.toContain("EXACT_SESSION_ID");
    }
  });

  it("keeps session graphs read-only and opens terminal context in a fresh window", () => {
    expect(workflowApp).toContain('type LibraryMode = "automations" | "sessions"');
    expect(workflowApp).toContain("readOnly/>");
    expect(workflowApp).toContain('openWindow("os-terminal", "Terminal", undefined, { initialCwd: sessionView.session.cwd || "~" }, { multi: true })');
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowApp = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
const workflowCanvas = readFileSync(new URL("./components/workflow-canvas.tsx", import.meta.url), "utf8");
const settingsSessions = readFileSync(new URL("../os-settings/components/mcp-sessions.tsx", import.meta.url), "utf8");
const settingsDetail = readFileSync(new URL("../os-settings/components/mcp-session-detail.tsx", import.meta.url), "utf8");
const sessionGuide = readFileSync(new URL("../os-settings/components/mcp-session-guide.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("./components/workflow-inspector.tsx", import.meta.url), "utf8");
const sessionDetails = readFileSync(new URL("./components/workflow-session-details.tsx", import.meta.url), "utf8");
const learningPanel = readFileSync(new URL("./components/workflow-learning-panel.tsx", import.meta.url), "utf8");
const sessionLibrary = readFileSync(new URL("./components/workflow-session-library.tsx", import.meta.url), "utf8");

describe("Workflow session graph UI contract", () => {
  it("routes Settings sessions into the Workflow Sessions view and never renders the internal id", () => {
    expect(settingsSessions).toContain('openWindow("workflows", "Workflows", undefined, { view: "sessions", sessionId: id })');
    expect(settingsSessions).toContain("session.label");
    for (const source of [settingsSessions, settingsDetail, sessionGuide, inspector]) {
      expect(source).not.toContain('label="Session ID"');
      expect(source).not.toContain("EXACT_SESSION_ID");
    }
  });

  it("keeps session graphs read-only and makes tool execution an explicit inspector action", () => {
    expect(workflowApp).toContain('type LibraryMode = "automations" | "sessions"');
    expect(workflowApp).toContain("readOnly/>");
    expect(workflowApp).toContain('const chooseSessionNode = (id: string | null) => {');
    expect(workflowApp).toContain('if (overlayPane) setDetailsOpen(true);');
    expect(workflowApp).toContain('else setShowDetails(true);');
    expect(workflowApp).toContain('if (!sessionView) return; setDetailsOpen(false); openWindow("os-terminal"');
    expect(workflowApp).toContain('const openSessionCode = (path: string) => { setDetailsOpen(false);');
    expect(sessionDetails).toContain("Open terminal here");
    expect(sessionDetails).toContain("Open {action.artifact.label} in Code");
    expect(sessionDetails).toContain('data-slot="session-action-group"');
    expect(sessionDetails).toContain("Action groups");
    expect(sessionDetails).toContain("action.artifact.revisionRef");
    expect(sessionDetails).toContain('data-slot="session-artifact-history"');
    expect(sessionDetails).toContain('data-slot="session-artifact-snapshot"');
    expect(sessionDetails).toContain('data-slot="session-artifact-diff"');
    expect(sessionDetails).toContain("Inspect revision");
    expect(sessionDetails).toContain("MSO will not guess a historical snapshot");
    expect(sessionDetails).toContain("S3.A4");
    expect(sessionDetails).toContain('data-slot="save-session-workflow-draft"');
    expect(sessionDetails).toContain('data-slot="save-step-workflow-draft"');
    expect(learningPanel).toContain('data-slot="session-self-improve"');
    expect(learningPanel).toContain("Self-improve");
    expect(workflowApp).toContain("saveSessionWorkflowDraft");
    expect(sessionDetails).toContain("WorkflowLearningPanel");
    expect(workflowApp).not.toContain("listWorkflowLearning().catch(() => [])");
    expect(learningPanel).toContain("include_archived");
    expect(learningPanel).toContain('role="alert"');
    expect(workflowCanvas).toContain('showMinimap={nodes.length > 3}');
    expect(workflowCanvas).not.toContain('showMinimap={!readOnly}');
  });

  it("gives the desktop session library enough width and lets labels wrap instead of clipping", () => {
    expect(workflowApp).toContain("grid-cols-[300px_minmax(0,1fr)]");
    expect(sessionLibrary).toContain("[overflow-wrap:anywhere]");
    expect(sessionLibrary).toContain("Page {data.page} of {data.pages}");
  });
});

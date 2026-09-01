import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { dispatch } = await import("./dispatch");
const { MCP_APP_MIME_TYPE, WORKFLOW_PROGRESS_URI } = await import("./ui-resources");
const { activeWorkflowForActor } = await import("@/lib/skills/memory");

const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("MCP Apps workflow progress UI", () => {
  it("advertises resources and binds workflow_start to the progress resource", async () => {
    const initialized = await dispatch({ id: 1, method: "initialize" }, "write", "mcp:ui-init");
    expect(initialized.result).toMatchObject({
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    });

    const listed = await dispatch({ id: 2, method: "tools/list" }, "write", "mcp:ui-list");
    const tools = (listed.result as {
      tools: Array<{ name: string; outputSchema?: unknown; _meta?: Record<string, unknown> }>;
    }).tools;
    const start = tools.find((tool) => tool.name === "workflow_start");
    expect(start?.outputSchema).toBeDefined();
    expect(start?._meta).toMatchObject({
      ui: { resourceUri: WORKFLOW_PROGRESS_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": WORKFLOW_PROGRESS_URI,
    });

    const status = tools.find((tool) => tool.name === "workflow_status");
    expect(status?.outputSchema).toBeDefined();
    expect(status?._meta).toMatchObject({
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
    });
  });

  it("serves one self-contained mcp-app resource", async () => {
    const listed = await dispatch({ id: 1, method: "resources/list" }, "read", "mcp:ui-resource");
    expect(listed.result).toMatchObject({
      resources: [expect.objectContaining({ uri: WORKFLOW_PROGRESS_URI, mimeType: MCP_APP_MIME_TYPE })],
    });

    const read = await dispatch({ id: 2, method: "resources/read", params: { uri: WORKFLOW_PROGRESS_URI } }, "read", "mcp:ui-resource");
    const content = (read.result as {
      contents: Array<{ uri: string; mimeType: string; text: string; _meta: Record<string, unknown> }>;
    }).contents[0];
    expect(content.uri).toBe(WORKFLOW_PROGRESS_URI);
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(content.text).toContain("workflow_status");
    expect(content.text).toContain("Open in MSO");
    expect(content.text).not.toContain("fetch(");
    expect(content._meta).toMatchObject({
      ui: { prefersBorder: true },
      "openai/widgetPrefersBorder": true,
    });
  });

  it("returns only redacted structured workflow state and keeps polling out of workflow memory", async () => {
    const actor = `mcp:ui-status-${Date.now()}`;
    const projectHint = "/private/operator/projects/mso";
    const started = await dispatch(call("workflow_start", {
      intent: "verify the ChatGPT progress widget",
      project: projectHint,
      constraints: "never expose secret-token=example in the widget",
    }), "write", actor);
    const startResult = started.result as {
      structuredContent?: {
        active: boolean;
        workflowId?: string;
        project?: string;
        stepCount: number;
        steps: Array<{ tool: string }>;
        [key: string]: unknown;
      };
      content: Array<{ text: string }>;
    };
    const workflowId = startResult.structuredContent?.workflowId;
    expect(workflowId).toBeTruthy();
    expect(startResult.structuredContent).toMatchObject({ active: true, workflowId, project: "mso" });
    expect(startResult.structuredContent).not.toHaveProperty("bootstrap");
    expect(startResult.structuredContent).not.toHaveProperty("search");
    expect(JSON.stringify(startResult.structuredContent)).not.toContain(projectHint);
    expect(JSON.stringify(startResult.structuredContent)).not.toContain("secret-token");

    // The portable text fallback intentionally keeps the pre-existing result shape
    // for MCP clients that do not render Apps UI.
    expect(JSON.parse(startResult.content[0].text).workflow.id).toBe(workflowId);

    const before = await activeWorkflowForActor(actor, workflowId!);
    expect(before).not.toBeNull();

    const statusCall = await dispatch(call("workflow_status", { workflow_id: workflowId }), "write", actor);
    const status = statusCall.result as {
      structuredContent?: { active: boolean; workflowId: string; project?: string; stepCount: number; steps: Array<{ tool: string }> };
    };
    expect(status.structuredContent).toMatchObject({ active: true, workflowId, project: "mso" });
    expect(status.structuredContent?.steps.some((step) => step.tool === "workflow_status")).toBe(false);
    expect(JSON.stringify(status.structuredContent)).not.toContain(projectHint);

    const after = await activeWorkflowForActor(actor, workflowId!);
    expect(after?.steps).toHaveLength(before!.steps.length);

    await dispatch(call("workflow_cancel", { workflow_id: workflowId, reason: "test cleanup" }), "write", actor);
    const closed = await dispatch(call("workflow_status", { workflow_id: workflowId }), "write", actor);
    expect((closed.result as { structuredContent?: { active: boolean } }).structuredContent?.active).toBe(false);
  });

  it("rejects unknown UI resource URIs", async () => {
    const result = await dispatch({ id: 1, method: "resources/read", params: { uri: "ui://mso/not-real.html" } }, "read");
    expect(result.error).toMatchObject({ code: -32602 });
  });
});

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
vi.stubEnv("OS_MCP_UI_ORIGIN", "");
vi.stubEnv("MSO_SURFACE_APPS_JSON", "");
afterAll(() => vi.unstubAllEnvs());

const { dispatch } = await import("./dispatch");
const {
  MSO_BLOCK_URI,
  MSO_PAGE_URI,
  LEGACY_BLOCK_V1_URI,
  LEGACY_PAGE_V1_URI,
  LEGACY_WORKFLOW_PROGRESS_URI,
  LEGACY_SURFACE_URI,
  readUiResource,
} = await import("./ui-resources");
const { activeWorkflowForActor } = await import("@/lib/workflow");

const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("MCP Apps Block and Page contract", () => {
  it("returns only redacted structured workflow state and keeps status polling out of workflow memory", async () => {
    const actor = `mcp:ui-status-${Date.now()}`;
    const projectHint = "/private/operator/projects/mso";
    const started = await dispatch(call("workflow_start", {
      intent: "verify the headless workflow contract",
      project: projectHint,
      constraints: "never expose secret-token=example in structured output",
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

  it("keeps latest cached workflow/surface URIs as non-advertised Block/Page aliases", async () => {
    const canonicalBlock = readUiResource(MSO_BLOCK_URI);
    const canonicalPage = readUiResource(MSO_PAGE_URI);
    const blockV1 = readUiResource(LEGACY_BLOCK_V1_URI);
    const pageV1 = readUiResource(LEGACY_PAGE_V1_URI);
    const legacyBlock = readUiResource(LEGACY_WORKFLOW_PROGRESS_URI);
    const legacyPage = readUiResource(LEGACY_SURFACE_URI);
    expect(blockV1).toMatchObject({ uri: LEGACY_BLOCK_V1_URI, text: canonicalBlock?.text });
    expect(pageV1).toMatchObject({ uri: LEGACY_PAGE_V1_URI, text: canonicalPage?.text });
    expect(legacyBlock).toMatchObject({ uri: LEGACY_WORKFLOW_PROGRESS_URI, text: canonicalBlock?.text });
    expect(legacyPage).toMatchObject({ uri: LEGACY_SURFACE_URI, text: canonicalPage?.text });

    const listed = await dispatch({ id: 31, method: "resources/list" }, "read", "mcp:ui-alias");
    const serialized = JSON.stringify(listed.result);
    expect(serialized).not.toContain(LEGACY_BLOCK_V1_URI);
    expect(serialized).not.toContain(LEGACY_PAGE_V1_URI);
    expect(serialized).not.toContain(LEGACY_WORKFLOW_PROGRESS_URI);
    expect(serialized).not.toContain(LEGACY_SURFACE_URI);
  });

  it("retires specialized operator resources in favor of the Page", async () => {
    for (const uri of [
      "ui://mso/project-status-v2.html",
      "ui://mso/project-diff-v2.html",
      "ui://mso/vps-status-v2.html",
    ]) {
      expect(readUiResource(uri)).toBeUndefined();
      const read = await dispatch({ id: 20, method: "resources/read", params: { uri } }, "read", "mcp:ui-retired");
      expect(read.error).toMatchObject({ code: -32602 });
    }
  });

  it("keeps native Page routes and portable tools/call refreshes", () => {
    const page = readUiResource(MSO_PAGE_URI)?.text ?? "";
    expect(page).toContain('route:"/monitor"');
    expect(page).toContain('route:"/project"');
    expect(page).toContain('route:"/diff"');
    expect(page).toContain('route:"/browser"');
    expect(page).toContain('rpcRequest("tools/call"');
  });

  it("rejects unknown UI resource URIs", async () => {
    const result = await dispatch({ id: 1, method: "resources/read", params: { uri: "ui://mso/not-real.html" } }, "read");
    expect(result.error).toMatchObject({ code: -32602 });
  });
});

import { afterAll, describe, expect, it, vi } from "vitest";
import { inlineScripts } from "../../scripts/test-support/inline-scripts";

vi.mock("server-only", () => ({}));
vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
vi.stubEnv("OS_MCP_UI_ORIGIN", "");
vi.stubEnv("MSO_SURFACE_APPS_JSON", "");
afterAll(() => vi.unstubAllEnvs());

const { dispatch } = await import("./dispatch");
const {
  MCP_APP_MIME_TYPE,
  MSO_BLOCK_URI,
  MSO_PAGE_URI,
} = await import("./ui-resources");
const { MCP_UI_DOMAIN, MSO_ORIGIN } = await import("./ui-config");

describe("MCP Apps Block and Page contract", () => {
  it("keeps workflow_start headless and binds only explicit Block/Page render tools", async () => {
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
    expect((start?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri).toBeUndefined();
    expect(start?._meta?.["openai/outputTemplate"]).toBeUndefined();

    const status = tools.find((tool) => tool.name === "workflow_status");
    expect(status?.outputSchema).toBeDefined();
    expect(status?._meta).toMatchObject({
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
    });

    const block = tools.find((tool) => tool.name === "render_mso_block");
    expect(block?.outputSchema).toBeDefined();
    expect(block?._meta).toMatchObject({
      ui: { resourceUri: MSO_BLOCK_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": MSO_BLOCK_URI,
      "openai/widgetAccessible": true,
    });

    const page = tools.find((tool) => tool.name === "render_mso_page");
    expect(page?.outputSchema).toBeDefined();
    expect(page?._meta).toMatchObject({
      ui: { resourceUri: MSO_PAGE_URI, visibility: ["model", "app"] },
      "openai/widgetAccessible": true,
    });
    expect(page?._meta?.["openai/outputTemplate"]).toBeUndefined();

    const setup = tools.find((tool) => tool.name === "integration_setup_open");
    expect(setup?._meta).toMatchObject({
      ui: { resourceUri: MSO_PAGE_URI, visibility: ["model", "app"] },
      "openai/widgetAccessible": true,
    });
    expect(setup?._meta?.["openai/outputTemplate"]).toBeUndefined();

    const legacy = tools.find((tool) => tool.name === "render_mso_surface");
    expect(legacy?._meta).toMatchObject({ ui: { visibility: ["app"] }, "openai/widgetAccessible": true });
    expect((legacy?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri).toBeUndefined();
    expect(legacy?._meta?.["openai/outputTemplate"]).toBeUndefined();

    const resourceBound = tools
      .filter((tool) => Boolean((tool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri))
      .map((tool) => tool.name)
      .sort();
    expect(resourceBound).toEqual(["integration_setup_open", "render_mso_block", "render_mso_page"]);
    const appOnly = tools
      .filter((tool) => {
        const visibility = (tool._meta?.ui as { visibility?: string[] } | undefined)?.visibility;
        return Array.isArray(visibility) && visibility.includes("app") && !visibility.includes("model");
      })
      .map((tool) => tool.name)
      .sort();
    expect(appOnly).toEqual(["render_mso_surface", "workflow_status"]);

    for (const name of ["project_get", "project_diff", "vps_status"] as const) {
      const tool = tools.find((row) => row.name === name);
      expect(tool?.outputSchema, name).toBeDefined();
      expect((tool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, name).toBeUndefined();
      expect(tool?._meta?.["openai/outputTemplate"], name).toBeUndefined();
    }
  });

  it("advertises exactly two canonical resources: one Block and one Page", async () => {
    const listed = await dispatch({ id: 1, method: "resources/list" }, "read", "mcp:ui-resource");
    const resources = (listed.result as { resources: Array<{ uri: string; name: string; mimeType: string }> }).resources;
    expect(resources).toEqual([
      expect.objectContaining({ uri: MSO_BLOCK_URI, name: "MSO Block", mimeType: MCP_APP_MIME_TYPE }),
      expect.objectContaining({ uri: MSO_PAGE_URI, name: "MSO Page", mimeType: MCP_APP_MIME_TYPE }),
    ]);
  });

  it("serves a self-contained compact Block with user-approved follow-up actions", async () => {
    const read = await dispatch({ id: 2, method: "resources/read", params: { uri: MSO_BLOCK_URI } }, "read", "mcp:ui-block");
    const content = (read.result as {
      contents: Array<{ uri: string; mimeType: string; text: string; _meta: Record<string, any> }>;
    }).contents[0];
    expect(content.uri).toBe(MSO_BLOCK_URI);
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(content.text).toContain("sendFollowUpMessage");
    expect(content.text).toContain("reportValidity");
    expect(content.text).toContain("label.id=controlId+\"-label\"");
    expect(content.text).toContain("label.htmlFor=controlId");
    expect(content.text).toContain("aria-labelledby");
    expect(content.text).toContain("input.maxLength=2000");
    expect(content.text).toContain("slice(0,12000)");
    expect(content.text).toContain("MSO block submission");
    expect(content.text).toContain("workflowFallback");
    const script = inlineScripts(content.text)[0];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    expect(content.text).not.toContain("fetch(");
    expect(content.text).not.toContain('rpcRequest("tools/call"');
    expect(content.text).not.toContain("dangerouslySetInnerHTML");
    expect(content._meta).toMatchObject({
      ui: { domain: MCP_UI_DOMAIN, prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      "openai/widgetDomain": MCP_UI_DOMAIN,
      "openai/widgetPrefersBorder": true,
    });
    expect(content._meta.ui.csp.frameDomains).toBeUndefined();
    expect(content._meta["openai/widgetCSP"]).toEqual({ redirect_domains: [MSO_ORIGIN] });
    expect(MSO_BLOCK_URI).toContain("block-v3.html");
  });

  it("serves the full Page without external frame domains by default", async () => {
    const read = await dispatch({ id: 30, method: "resources/read", params: { uri: MSO_PAGE_URI } }, "read", "mcp:ui-page");
    const content = (read.result as { contents: Array<{ mimeType: string; text: string; _meta: Record<string, any> }> }).contents[0];
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(content.text).toContain("requestDisplayMode");
    expect(content.text).toContain("setWidgetState");
    expect(content.text).toContain("render_mso_page");
    expect(content.text).not.toMatch(/rahmanef\.com|\/home\/rahman/);
    expect(content.text).toContain("const SAFE_APPS=[]");
    expect(content.text).toContain('app.environment+" · "+app.renderer');
    expect(content.text).toContain("fetch(endpoint,");
    expect(content.text).toContain('credentials:"omit"');
    expect(content.text).toContain('access.endpoint===INTEGRATION_ENDPOINT');
    expect(content.text).not.toContain("allow-popups");
    expect(content.text).not.toContain("allow-top-navigation");
    expect(content.text).not.toContain("dangerouslySetInnerHTML");
    expect(content._meta.ui.csp).toMatchObject({
      connectDomains: [MSO_ORIGIN],
      resourceDomains: [],
    });
    expect(content._meta.ui.csp.frameDomains).toBeUndefined();
    expect(content._meta["openai/widgetCSP"]).toEqual({ connect_domains: [MSO_ORIGIN], redirect_domains: [MSO_ORIGIN] });
    expect(MSO_PAGE_URI).toContain("page-v15.html");
    expect(content.text).not.toContain("createElement(\"iframe\")");
    expect(content.text).not.toContain("mountReviewedFrame");
  });

});

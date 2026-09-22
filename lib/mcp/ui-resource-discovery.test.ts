import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
vi.stubEnv("OS_MCP_UI_ORIGIN", "");
vi.stubEnv("MSO_SURFACE_APPS_JSON", "");
afterAll(() => vi.unstubAllEnvs());

const { dispatch } = await import("./dispatch");
const {
  MCP_APP_MIME_TYPE,
  MSO_BLOCK_URI,
  MSO_LIST_URI,
  MSO_NATIVE_UI_PROBE_URI,
  MSO_PAGE_URI,
} = await import("./ui-resources");

describe("MCP App resource discovery", () => {
  it("advertises the three product resources plus the isolated Native UI diagnostic probe", async () => {
    const listed = await dispatch({ id: 1, method: "resources/list" }, "read", "mcp:ui-resource");
    const resources = (listed.result as {
      resources: Array<{ uri: string; name: string; mimeType: string; _meta?: Record<string, any> }>;
    }).resources;
    expect(resources).toEqual([
      expect.objectContaining({ uri: MSO_LIST_URI, name: "MSO List", mimeType: MCP_APP_MIME_TYPE }),
      expect.objectContaining({ uri: MSO_BLOCK_URI, name: "MSO Block", mimeType: MCP_APP_MIME_TYPE }),
      expect.objectContaining({ uri: MSO_PAGE_URI, name: "MSO Page", mimeType: MCP_APP_MIME_TYPE }),
      expect.objectContaining({ uri: MSO_NATIVE_UI_PROBE_URI, name: "MSO Native UI Probe", mimeType: MCP_APP_MIME_TYPE }),
    ]);
    for (const resource of resources) {
      expect(resource._meta?.ui, resource.uri).toBeDefined();
    }
  });

  it("serves the Native UI probe as static dependency-free HTML", async () => {
    const read = await dispatch({ id: 31, method: "resources/read", params: { uri: MSO_NATIVE_UI_PROBE_URI } }, "read", "mcp:ui-native-probe");
    const content = (read.result as { contents: Array<{ uri: string; mimeType: string; text: string; _meta: Record<string, any> }> }).contents[0];
    expect(content.uri).toBe(MSO_NATIVE_UI_PROBE_URI);
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(content.text).toContain("MSO NATIVE UI WORKS");
    expect(content.text).not.toContain("<script");
    expect(content.text).not.toContain("fetch(");
    expect(content.text).not.toContain("iframe");
    expect(content._meta).toEqual({
      ui: {
        prefersBorder: true,
        csp: { connectDomains: [], resourceDomains: [] },
      },
    });
  });

});

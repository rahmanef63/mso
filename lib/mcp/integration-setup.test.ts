import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { capabilityDirect, capabilityPrivateMeta } from "@/lib/capabilities/tool";
import { structuredResult } from "./dispatch-tool-support";
import { SURFACE_TOOLS } from "./tools-surface";
import { resolveSurfaceRoute } from "./surface-catalog";
import { msoSurfaceScript } from "./ui-surface-script";
describe("MCP integration setup privacy", () => {
  it("keeps UI authorization out of serializable/model-visible result fields", () => {
    const secret = "synthetic-ui-only-capability";
    const raw = capabilityDirect([{ type: "text", text: "Form opened" }], false, { route: "/integrations" }, { integrationSetup: { token: secret } });
    expect(JSON.stringify(raw)).not.toContain(secret); expect(capabilityPrivateMeta(raw)).toBeDefined();
    const wire = structuredResult("integration_setup_open", raw, "chatgpt");
    expect(wire).toHaveProperty("_meta.integrationSetup.token", secret);
    expect(JSON.stringify(wire.content)).not.toContain(secret); expect(JSON.stringify(wire.structuredContent)).not.toContain(secret);
    expect(structuredResult("integration_setup_open", raw, "full")).toHaveProperty("_meta.integrationSetup.token", secret);
    // Generic model transports still serialize the weak-map-free raw result.
    expect(JSON.stringify(raw)).not.toContain(secret);
  });
  it("requires write scope, accepts no credential parameters, and uses the existing Page", async () => {
    const tool = SURFACE_TOOLS.find(t => t.name === "integration_setup_open")!;
    expect(tool.scope).toBe("write"); expect(Object.keys(tool.inputSchema.properties)).toEqual(["user", "connection", "provider", "method"]);
    expect((tool.meta?.ui as { resourceUri?: string }).resourceUri).toMatch(/^ui:\/\/mso\/page-v13\.html$/);
    expect(tool.meta?.["openai/outputTemplate"]).toBeUndefined();
    expect((await resolveSurfaceRoute("/integrations")).kind).toBe("integrations");
    const script = await msoSurfaceScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('"ui/initialize"');
    expect(script).toContain('credentials:"omit"');
    expect(script).toContain('save.type="button"');
    expect(script).toContain('rpcRequest("ui/open-link"');
    expect(script).toContain('"mcp_tool_result"');
  });
});

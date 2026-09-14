import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const registry = readFileSync("frontend/slices/os-settings/components/mcp-plugin-registry.tsx", "utf8");
const runtime = readFileSync("frontend/slices/os-settings/components/mcp-plugin-runtime.tsx", "utf8");
const section = readFileSync("frontend/slices/os-settings/components/mcp-section.tsx", "utf8");
const navigation = readFileSync("frontend/slices/os-settings/components/mcp-navigation.tsx", "utf8");
describe("project plugin installation UX contract", () => {
  it("describes built-ins as available catalog entries rather than installed defaults", () => {
    expect(registry).toContain("not default project dependencies");
    expect(registry).toContain('{isCustom ? "Custom catalog" : "Available"}');
    expect(navigation).toContain('title: "Project plugins"');
  });
  it("uses install/uninstall language and sends plugin identity for both reviewed plugins", () => {
    expect(runtime).toContain('"Install to project"'); expect(runtime).toContain(">Check installation</Button>"); expect(runtime).toContain('>Uninstall</Button>');
    expect(runtime).toContain('{ plugin: "batonly", user, connection }');
    expect(runtime).not.toContain('url: endpoint');
  });
  it("states that host credentials do not install or propagate project plugins", () => {
    expect(section).toContain("does not install a plugin into any project");
    expect(section).toContain("parent/sibling projects never inherit the binding");
  });
});

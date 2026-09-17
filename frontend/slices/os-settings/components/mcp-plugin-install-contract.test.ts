import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (file: string) => readFileSync(file, "utf8");
const registry = read("frontend/slices/os-settings/components/mcp-plugin-registry.tsx");
const store = read("frontend/slices/app-store/app.tsx");
const panel = read("frontend/slices/extensions/mcp-panel.tsx");
const hook = read("frontend/slices/extensions/use-mcp-installations.ts");
const builtin = read("frontend/slices/extensions/mcp-builtin.tsx");
const section = read("frontend/slices/os-settings/components/mcp-section.tsx");
describe("shared VPS plugin installation UX", () => {
  it("shares Store and Settings MCP/Skills panels, while retaining the existing Apps panel", () => {
    expect(registry).toContain('ExtensionTabs as McpPluginRegistry');
  });
  it("has distinct Apps MCP and Skills tabs backed by the shared slice", () => {
    expect(store).toContain('"@/features/extensions"'); expect(registry).toContain('"@/features/extensions"');
    for (const label of ["Apps", "MCP", "Skills"]) expect(store).toContain(`label: "${label}"`);
    expect(store).toContain("<AppsPanel />");
  });
  it("uses real server state and revisions rather than browser installation flags", () => {
    expect(hook).toContain('"/api/v1/project-mcp"'); expect(hook).toContain("snapshot.revision"); expect(hook).not.toContain("localStorage");
    expect(panel).toContain('useState("@host")'); expect(panel).toContain("Host installs are not inherited"); expect(panel).toContain('mutate("delete"');
  });
  it("preserves credential identity and distinguishes remote connection from runtime download", () => {
    expect(builtin).toContain('plugin: plugin.id'); expect(builtin).toContain("user, connection"); expect(builtin).toContain("does not download or self-host");
    expect(section).toContain("does not install a plugin into any project"); expect(section).toContain("parent/sibling projects never inherit the binding");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: async (role: string) => role === "viewer" }));
import { GET } from "@/app/api/v1/fs/read/route";
import { READ_TOOLS } from "./tools-read";
import { publicProjectMcpServers, readProjectMcpServers } from "@/lib/host/project-mcp-config";
import { listDir } from "@/lib/host/fs-enumeration";
let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "mso-credential-read-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("OS_FS_READ_ROOTS", home);
  vi.stubEnv("OS_FS_ALLOW_SENSITIVE", undefined);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
const fsRead = READ_TOOLS.find(tool => tool.name === "fs_read")!;
describe("Viewer HTTP and read-scope MCP credential boundary", () => {
  it("opens only an allowed root and omits the disallowed Home jump point", async () => {
    const project = path.join(home, "projects", "app");
    await mkdir(project, { recursive: true }); await writeFile(path.join(project, "README.md"), "public-project");
    vi.stubEnv("OS_FS_READ_ROOTS", project);
    const listing = await listDir("~");
    expect(listing.path).toBe(project);
    expect(listing.entries.map(entry => entry.name)).toContain("README.md");
    expect(listing.roots?.some(root => root.path === home)).toBe(false);
    expect(listing.parent).toBeNull();
    await expect(listDir(home)).rejects.toThrow(/outside readable roots/);
  });
  it.each([".terraform.d/credentials.tfrc.json", ".pypirc", ".config/pypoetry/auth.toml", ".config/doctl/config.yaml", ".azure/accessTokens.json", ".mozilla/firefox/profile/cookies.sqlite", ".config/google-chrome/Default/Cookies", ".config/chromium/Default/Cookies", "projects/app/.mcp.json", "projects/app/.npmrc"])("refuses %s even inside an explicitly broad read root", async name => {
    const target = path.join(home, name);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "synthetic-credential", { mode: 0o600 });
    const response = await GET(new Request("http://localhost/api/v1/fs/read?" + new URLSearchParams({ path: target })));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("synthetic-credential");
    expect(fsRead.scope).toBe("read");
    await expect(fsRead.run({ path: target }, { scope: "read", principal: "fixture" })).rejects.toThrow(/credential|sensitive/);
  });
  it("preserves the dedicated redacted MCP inventory while refusing raw config", async () => {
    const project = path.join(home, "projects", "app"); await mkdir(project, { recursive: true });
    await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { example: { command: "node", env: { ACCESS_TOKEN: "synthetic-private-value" } } } }), { mode: 0o600 });
    const inventory = publicProjectMcpServers(await readProjectMcpServers(project));
    expect(inventory).toMatchObject([{ name: "example", transport: "stdio" }]);
    expect(JSON.stringify(inventory)).not.toContain("synthetic-private-value");
    await expect(fsRead.run({ path: path.join(project, ".mcp.json") }, { scope: "read", principal: "fixture" })).rejects.toThrow(/credential|sensitive/);
  });
});

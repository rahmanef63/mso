import { afterEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("@/lib/infra/connection-service", () => ({ directConnectionValues: async () => ({ endpoint: "https://example.test/mcp", accessToken: "private-value" }) }));
let root = "";
afterEach(async () => { vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive: true, force: true }); });
it("preserves existing servers, refuses stale revisions and stores only private connection references", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-mcp-manage-"));
  vi.stubEnv("OS_FS_WRITE_ROOTS", root); vi.stubEnv("OS_FS_READ_ROOTS", root); vi.resetModules();
  const { inspectProjectMcp, manageProjectMcp } = await import("./project-mcp-manage");
  const first = await inspectProjectMcp(root);
  expect(first.revision).toBe("new");
  const saved = await manageProjectMcp(root, { action: "upsert", server: "one", revision: first.revision, url: "https://example.test/mcp", user: "owner", connection: "private" });
  await expect(manageProjectMcp(root, { action: "delete", server: "one", revision: "new" })).rejects.toThrow("revision changed");
  await manageProjectMcp(root, { action: "upsert", server: "two", revision: saved.revision, url: "https://public.test/mcp" });
  const current = await inspectProjectMcp(root);
  expect(current.servers.map(s => s.name)).toEqual(["one", "two"]);
  expect(await fs.readFile(path.join(root, ".mcp.json"), "utf8")).not.toContain("private-value");
  await expect(manageProjectMcp(root, { action: "upsert", server: "bad", revision: current.revision, url: "https://other.test/mcp", user: "owner", connection: "private" })).rejects.toThrow("does not match");
  await manageProjectMcp(root, { action: "delete", server: "one", revision: current.revision });
  expect((await inspectProjectMcp(root)).servers.map(s => s.name)).toEqual(["two"]);
});

it("stores managed SC without a command or copied account and permits removal when SC is absent", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-managed-sc-"));
  vi.stubEnv("OS_FS_WRITE_ROOTS", root); vi.stubEnv("OS_FS_READ_ROOTS", root); vi.resetModules();
  const { inspectProjectMcp, manageProjectMcp } = await import("./project-mcp-manage");
  const saved = await manageProjectMcp(root, { action: "upsert", server: "si-coder", revision: "new", plugin: "si-coder" });
  expect(JSON.parse(await fs.readFile(path.join(root, ".mcp.json"), "utf8"))).toEqual({ mcpServers: { "si-coder": { plugin: "si-coder", credentialAuthority: "mso" } } });
  expect((await inspectProjectMcp(root)).servers[0]).toMatchObject({ name: "si-coder", transport: "stdio", plugin: "si-coder", credentialAuthority: "mso" });
  await expect(manageProjectMcp(root, { action: "upsert", server: "si-coder", revision: saved.revision, plugin: "si-coder", user: "other" })).rejects.toThrow("no copied account");
  await manageProjectMcp(root, { action: "delete", server: "si-coder", revision: saved.revision });
  expect((await inspectProjectMcp(root)).servers).toHaveLength(0);
});

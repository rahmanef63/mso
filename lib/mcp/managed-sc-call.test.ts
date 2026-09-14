import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ servers: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/host/project-mcp-config", () => ({ readProjectMcpServers: f.servers }));
vi.mock("@/lib/infra/connection-dispatch", () => ({ queryIntegrationAction: f.query, executeIntegrationAction: f.execute }));
import { callManagedScProvider } from "./managed-sc-call";
beforeEach(() => { vi.clearAllMocks(); f.servers.mockResolvedValue([{ name: "si-coder", transport: "plugin", plugin: "si-coder" }]); f.query.mockResolvedValue({ users: [{ id: "native-only" }] }); });
describe("MSO-managed SC orchestration", () => {
  it("returns native users with provenance without launching SC account management", async () => {
    const result = await callManagedScProvider("/fixture", "si-coder", "sc.user.list", {});
    expect(result).toMatchObject({ handled: true, result: { structuredContent: { authority: "mso", result: { users: [{ id: "native-only" }] } } } });
    expect(f.query).toHaveBeenCalledWith({ view: "users" });
  });
  it("does not intercept a separately declared standalone connection", async () => {
    f.servers.mockResolvedValue([{ name: "si-coder", transport: "stdio" }]);
    expect(await callManagedScProvider("/fixture", "si-coder", "sc.user.list", {})).toEqual({ handled: false });
    expect(f.query).not.toHaveBeenCalled();
  });
  it("refuses duplicate store mutations in managed mode", async () => {
    await expect(callManagedScProvider("/fixture", "si-coder", "sc.user.create", { user: "duplicate" })).rejects.toThrow("unavailable in MSO-managed SC");
    expect(f.query).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
});

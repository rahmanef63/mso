import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
const executeNative = (mode: "query" | "execute", args: Record<string, unknown>) => mode === "query" ? native.query(args) : native.execute(args);
import { managedScCall, managedScTools } from "./sc-consumer";
beforeEach(() => { vi.clearAllMocks(); native.query.mockResolvedValue({ users: [] }); native.execute.mockResolvedValue({ verified: true }); });
describe("SC consumes MSO authority", () => {
  it("routes account discovery into native MSO rather than SC's store", async () => {
    const result = await managedScCall("sc.user.list", {}, executeNative);
    expect(native.query).toHaveBeenCalledWith({ view: "users" }); expect(result.handled).toBe(true);
  });
  it("requires the exact connection for verification with no account fallback", async () => {
    await expect(managedScCall("sc.user.provider.verify", { user: "owner", provider: "github" }, executeNative)).rejects.toThrow("explicit_mso_connection_context_required");
    expect(native.execute).not.toHaveBeenCalled();
    await managedScCall("sc.user.provider.verify", { user: "owner", provider: "cf", connection: "work" }, executeNative);
    expect(native.execute).toHaveBeenCalledWith({ user: "owner", provider: "cloudflare", connection: "work", operation: "verify" });
  });
  it("hides and refuses duplicate-store writes, transfers and unaudited execution", async () => {
    const names = ["sc.version", "sc.user.list", "sc.user.create", "sc.data.import", "sc.flow.run"];
    expect(managedScTools(names.map(name => ({ name, inputSchema: {} }))).map(t => t.name)).toEqual(["sc.version", "sc.user.list"]);
    for (const name of names.slice(2)) await expect(managedScCall(name, {})).rejects.toThrow("unavailable in MSO-managed SC");
  });
  it("leaves standalone workspace tools on the local MCP implementation", async () => {
    expect(await managedScCall("sc.version", {})).toEqual({ handled: false }); expect(native.query).not.toHaveBeenCalled();
  });
});

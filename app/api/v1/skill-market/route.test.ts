import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ role: "owner" as string | null, demo: false, list: vi.fn(), manage: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: async () => state.role ? { role: state.role, session: { device_id: "test-owner" } } : null }));
vi.mock("@/lib/demo", () => ({ get IS_DEMO() { return state.demo; } }));
vi.mock("@/lib/host/skill-market-api", () => ({ listSkillMarket: state.list, manageSkillMarket: state.manage }));
vi.mock("@/lib/host/audit-api", () => ({ audit: state.audit }));
import { GET, POST } from "./route";
const request = (body: unknown) => new NextRequest("https://mso.example/api/v1/skill-market", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.role = "owner"; state.demo = false; state.list.mockResolvedValue({ skills: [] }); state.manage.mockResolvedValue({ skills: [] }); });
it("only permits owner devices and keeps demo writes disabled", async () => {
  for (const role of [null, "viewer", "operator"]) { state.role = role; expect((await GET()).status).toBe(403); expect((await POST(request({ action: "install", id: "ponytail" }))).status).toBe(403); }
  state.role = "owner"; state.demo = true; expect((await GET()).status).toBe(403); expect(state.list).not.toHaveBeenCalled(); expect(state.manage).not.toHaveBeenCalled();
});
it("uses the canonical lifecycle and records the confirmed mutation", async () => {
  const body = { action: "install", id: "ponytail", revision: "a".repeat(64) };
  expect((await POST(request(body))).status).toBe(200); expect(state.manage).toHaveBeenCalledWith(body); expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "fs.write", ok: true, target: "ponytail" }));
  expect((await GET()).headers.get("Cache-Control")).toContain("no-store");
});
it("requires a fresh revision and reports lifecycle refusal", async () => {
  expect((await POST(request({ action: "remove", id: "ponytail" }))).status).toBe(400); expect(state.manage).not.toHaveBeenCalled();
  state.manage.mockRejectedValue(new Error("Skill revision changed"));
  expect((await POST(request({ action: "remove", id: "ponytail", revision: "a".repeat(64) }))).status).toBe(400);
});

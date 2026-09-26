import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: "owner", run: vi.fn(async () => [{ id: "npm-cache", ok: true, freedBytes: 1 }]) }));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: async () => true }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: async () => ({ role: mocks.role, session: { device_id: "test" } }) }));
vi.mock("@/lib/host/request-api", () => ({ readJson: (req: Request) => req.json(), apiError: (_: string, error: Error) => Response.json({ error: error.message }, { status: 400 }) }));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
vi.mock("@/lib/host/cleanup", () => ({ runCleanup: mocks.run, scanCleanup: async () => [{ id: "npm-cache", available: true, bytes: 1 }, { id: "tmp-old", available: true, bytes: 1 }] }));
import { GET, POST } from "./route";
beforeEach(() => { mocks.role = "owner"; mocks.run.mockClear(); });
const request = (body: unknown) => new Request("http://localhost/api/v1/sys/cleanup", { method: "POST", body: JSON.stringify(body) });
describe("cleanup owner guard and preview", () => {
  it("denies operators and never calls the cleanup kernel", async () => { mocks.role = "operator"; expect((await GET(request({}))).status).toBe(403); expect((await POST(request({ ids: ["npm-cache"], confirm: true }))).status).toBe(403); expect(mocks.run).not.toHaveBeenCalled(); });
  it("blocks protected paths and requires a server-issued preview", async () => {
    const preview = await (await GET(request({}))).json(); expect(preview.items.find((item: {id: string}) => item.id === "tmp-old").available).toBe(false);
    expect((await POST(request({ ids: ["tmp-old"], preview_id: preview.preview.id, confirm: true }))).status).toBe(400);
    expect((await POST(request({ ids: ["npm-cache"], preview_id: "forged", confirm: true }))).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
    expect((await POST(request({ ids: ["npm-cache"], preview_id: preview.preview.id, confirm: true }))).status).toBe(200); expect(mocks.run).toHaveBeenCalledOnce();
  });
});

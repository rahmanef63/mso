import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), discover: vi.fn(), register: vi.fn(), remove: vi.fn(), resolve: vi.fn(), send: vi.fn(), get: vi.fn(), cancel: vi.fn(), handoff: vi.fn(), audit: vi.fn(), rate: vi.fn(),
}));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: vi.fn(async () => ({ role: "owner", session: { device_id: "cli-test" } })) }));
vi.mock("@/lib/a2a", () => ({ listA2AAgents: mocks.list, discoverA2AAgent: mocks.discover, registerA2AAgent: mocks.register, removeA2AAgent: mocks.remove, resolveA2AAgent: mocks.resolve, sendA2AMessage: mocks.send, getA2ATask: mocks.get, cancelA2ATask: mocks.cancel, handoffA2A: mocks.handoff }));
vi.mock("@/lib/host", () => ({ audit: mocks.audit, rateLimited: mocks.rate, readJson: async (req: Request) => req.json().catch(() => null) }));

const { GET, POST } = await import("./route");
const post = (body: object) => new NextRequest("http://localhost/api/v1/a2a", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => { vi.clearAllMocks(); mocks.rate.mockReturnValue(false); mocks.resolve.mockResolvedValue({ card: { name: "Peer" } }); });

describe("A2A CLI API", () => {
  it("lists and discovers agents", async () => {
    mocks.list.mockResolvedValue([{ alias: "peer" }]); mocks.discover.mockResolvedValue({ card: { name: "Peer" } });
    expect(await (await GET(new NextRequest("http://localhost/api/v1/a2a"))).json()).toEqual({ agents: [{ alias: "peer" }] });
    const found = await (await GET(new NextRequest("http://localhost/api/v1/a2a?action=discover&url=https%3A%2F%2Fpeer.example"))).json(); expect(found.card.name).toBe("Peer");
  });
  it("routes register/send/task/cancel/handoff without adding hidden context", async () => {
    mocks.register.mockResolvedValue({ alias: "peer" }); mocks.send.mockResolvedValue({ task: { id: "t1" } }); mocks.get.mockResolvedValue({ id: "t1" }); mocks.cancel.mockResolvedValue({ id: "t1" }); mocks.handoff.mockResolvedValue({ handoff: {}, response: { task: { id: "t2" } } });
    expect((await POST(post({ action: "register", url: "https://peer.example", alias: "peer" }))).status).toBe(200);
    expect((await POST(post({ action: "send", target: "peer", message: "hello" }))).status).toBe(200); expect(mocks.send.mock.calls[0][1]).toBe("hello");
    const task = await GET(new NextRequest("http://localhost/api/v1/a2a?action=task&target=peer&taskId=t1")); expect(task.status).toBe(200);
    expect((await POST(post({ action: "cancel", target: "peer", taskId: "t1" }))).status).toBe(200);
    expect((await POST(post({ action: "handoff", target: "peer", objective: "research", context: "only this" }))).status).toBe(200);
    expect(mocks.handoff.mock.calls[0][1]).toBe("research"); expect(mocks.handoff.mock.calls[0][2]).toBe("only this");
  });
});

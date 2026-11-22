import { afterAll, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionPayload } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  session: null as SessionPayload | null,
  data: null as ((chunk: string, offset: number) => void) | null,
  detach: vi.fn(),
  close: vi.fn(),
  attach: vi.fn(),
  hasPty: vi.fn((_id: string, _actor: string) => true),
}));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: async () => (mocks.session ? { session: mocks.session, role: "owner" } : null),
}));
vi.mock("@/lib/host/terminal-api", () => ({
  hasPty: (id: string, actor: string) => mocks.hasPty(id, actor),
  closePty: mocks.close,
  attachPty: (id: string, owner: string, from: number, callbacks: { onData: typeof mocks.data }) => {
    mocks.attach(id, owner, from);
    mocks.data = callbacks.onData;
    return mocks.detach;
  },
}));

const root = await mkdtemp(path.join(os.tmpdir(), "mso-term-live-"));
process.env.OS_DEVICE_STORE = path.join(root, "devices.json");
const devices = await import("@/lib/auth/device-store");
const { GET } = await import("./route");
const id = "a".repeat(32);
await devices.approveDevice(id); await devices.approveDevice("b".repeat(32));
afterEach(() => {
  mocks.close.mockClear();
  mocks.detach.mockClear();
  mocks.attach.mockClear();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.hasPty.mockReturnValue(true);
});
afterAll(async () => { delete process.env.OS_DEVICE_STORE; await rm(root, { recursive: true, force: true }); });

it("refuses the stream without an authenticated session instead of opening and closing it", async () => {
  const policy = await devices.currentSessionPolicy("host");
  mocks.session = { device_id: id, issued_at: Date.now(), expires_at: Date.now() + 60_000, cookie_scope: policy.scope, cookie_epoch: policy.epoch };
  mocks.verifyAuth.mockResolvedValueOnce(false);
  const unauthedRes = await GET(new Request("https://host.test/api/v1/term/stream?id=pty"));
  expect(unauthedRes.status).toBe(401);
  expect(await unauthedRes.json()).toEqual({ error: "unauthorized" });
  expect(mocks.attach).not.toHaveBeenCalled();

  mocks.session = null;
  mocks.verifyAuth.mockResolvedValueOnce(true);
  const noSessionRes = await GET(new Request("https://host.test/api/v1/term/stream?id=pty"));
  expect(noSessionRes.status).toBe(401);
  expect(await noSessionRes.json()).toEqual({ error: "unauthorized" });
  expect(mocks.attach).not.toHaveBeenCalled();
});

it("refuses with 400 without opening the stream when pty does not exist", async () => {
  const policy = await devices.currentSessionPolicy("host");
  mocks.session = { device_id: id, issued_at: Date.now(), expires_at: Date.now() + 60_000, cookie_scope: policy.scope, cookie_epoch: policy.epoch };
  mocks.hasPty.mockReturnValueOnce(false);
  const res = await GET(new Request("https://host.test/api/v1/term/stream?id=unknown-pty"));
  expect(res.status).toBe(400);
  expect(mocks.attach).not.toHaveBeenCalled();
});

it("rechecks live Owner authority before data delivery and kills the PTY after demotion", async () => {
  const policy = await devices.currentSessionPolicy("host");
  mocks.session = { device_id: id, issued_at: Date.now(), expires_at: Date.now() + 60_000, cookie_scope: policy.scope, cookie_epoch: policy.epoch };
  const response = await GET(new Request("https://host.test/api/v1/term/stream?id=pty"));
  const reader = response.body!.getReader();
  mocks.data!("permitted", 9);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: data");
  await devices.setDeviceRole(id, "viewer");
  mocks.data!("private-output-after-demotion", 30);
  expect((await reader.read()).done).toBe(true);
  expect(mocks.detach).toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledWith("pty", id);
});

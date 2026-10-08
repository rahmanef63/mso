import { afterAll, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionPayload } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({ session: null as SessionPayload | null, data: null as ((chunk: string, offset: number) => void) | null, detach: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: async () => true }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: async () => ({ session: mocks.session, role: "owner" }) }));
vi.mock("@/lib/host/terminal-api", () => ({ hasPty: () => true, closePty: mocks.close, attachPty: (_id: string, _owner: string, _from: number, callbacks: { onData: typeof mocks.data }) => { mocks.data = callbacks.onData; return mocks.detach; } }));

const root = await mkdtemp(path.join(os.tmpdir(), "mso-term-live-"));
process.env.OS_DEVICE_STORE = path.join(root, "devices.json");
const devices = await import("@/lib/auth/device-store");
const { GET } = await import("./route");
const id = "a".repeat(32);
await devices.approveDevice(id); await devices.approveDevice("b".repeat(32));
afterEach(() => { mocks.close.mockClear(); mocks.detach.mockClear(); });
afterAll(async () => { delete process.env.OS_DEVICE_STORE; await rm(root, { recursive: true, force: true }); });

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

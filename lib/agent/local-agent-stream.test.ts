import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
const mocks = vi.hoisted(() => ({device: vi.fn(), policy: vi.fn(), inbox: vi.fn(), update: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn()}));
vi.mock("@/lib/auth/device-store", () => ({getApprovedDevice: mocks.device, currentSessionPolicy: mocks.policy}));
vi.mock("@/lib/auth/session-cookie", () => ({configuredSessionCookieScope: () => "host"}));
vi.mock("./local-agent-events", () => ({subscribeLocalAgentMessages: mocks.subscribe}));
vi.mock("./local-agent-mailbox", () => ({listLocalAgentInbox: mocks.inbox, updateLocalAgentMessageState: mocks.update}));
import { localAgentStream } from "./local-agent-stream";
let session: SessionPayload, device: {role: string; approvedAt: number; sessionsRevokedAt?: number} | null, epoch: string;
let event: (value: unknown) => void;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  const now = Date.now(); epoch = "epoch-original-12345";
  session = {device_id: "device", issued_at: now, expires_at: now + 60_000, cookie_scope: "host", cookie_epoch: epoch};
  device = {role: "owner", approvedAt: now - 1000};
  mocks.device.mockImplementation(async () => device);
  mocks.policy.mockImplementation(async () => ({scope: "host", epoch}));
  mocks.inbox.mockResolvedValue([]); mocks.update.mockResolvedValue(undefined);
  mocks.subscribe.mockImplementation((_id, callback) => {event = callback; return mocks.unsubscribe;});
});
afterEach(() => vi.useRealTimers());
async function open() {
  const abort = new AbortController();
  const response = localAgentStream("web:device", "session", session, abort.signal);
  const reader = response.body!.getReader();
  await vi.advanceTimersByTimeAsync(0);
  return {reader, abort};
}
describe("local-agent SSE live signed-session authority", () => {
  it.each(["revoked", "demoted", "logout", "expired", "epoch"])("closes before disclosing another message when %s", async (reason) => {
    const {reader} = await open();
    event({id: "before", text: "authorized"});
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("authorized");
    if (reason === "revoked") device = null;
    if (reason === "demoted") device!.role = "operator";
    if (reason === "logout") device!.sessionsRevokedAt = session.issued_at;
    if (reason === "expired") session.expires_at = Date.now();
    if (reason === "epoch") epoch = "epoch-rotated-12345";
    event({id: "after", text: "private-after-revocation"});
    expect(await reader.read()).toEqual({done: true, value: undefined});
    expect(mocks.unsubscribe).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("closes an idle stream within one second of revocation", async () => {
    const {reader} = await open(); device = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect((await reader.read()).done).toBe(true);
    expect(mocks.unsubscribe).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("rechecks authorization after waiting for durable backlog", async () => {
    let replay!: (rows: unknown[]) => void;
    mocks.inbox.mockImplementation(() => new Promise(resolve => {replay = resolve;}));
    const {reader} = await open(); device = null;
    replay([{id: "private", state: "pending", text: "secret"}]);
    expect((await reader.read()).done).toBe(true); expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["cancel", "abort"])("removes subscriptions and timers on %s", async (how) => {
    const {reader, abort} = await open();
    if (how === "cancel") await reader.cancel(); else abort.abort();
    expect(mocks.unsubscribe).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("fails closed on authority-store errors", async () => {
    const {reader} = await open(); mocks.device.mockRejectedValue(new Error("unavailable"));
    event({text: "secret"}); expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("disconnects consumers that do not drain the bounded byte queue", async () => {
    const {reader} = await open();
    event({text: "x".repeat(150_000)}); await vi.advanceTimersByTimeAsync(0);
    event({text: "x".repeat(150_000)}); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.unsubscribe).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    await reader.cancel();
  });
});

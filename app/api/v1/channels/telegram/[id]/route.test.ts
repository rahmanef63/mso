import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ receive: vi.fn(), dispatch: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/host/rate-limit", () => ({ rateLimitedUntrusted: mocks.rate }));
vi.mock("@/lib/channels", () => {
  class ChannelError extends Error {
    constructor(public readonly code: string, public readonly status = 400) { super(code); }
  }
  return { ChannelError, receiveTelegram: mocks.receive, dispatchChannelInbound: mocks.dispatch };
});

const { POST } = await import("./route");
const request = () => new NextRequest("https://mso.example.test/api/v1/channels/telegram/channel-1", {
  method: "POST",
  headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "secret_123" },
  body: JSON.stringify({ update_id: 7 }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockReturnValue(false);
  mocks.receive.mockResolvedValue({ provider: "telegram", eventId: "7", kind: "message", receivedAt: new Date().toISOString(), raw: {} });
  mocks.dispatch.mockResolvedValue({ workflow: { runId: "run-1", state: "running", graphId: "flow-1" } });
});

describe("Telegram channel webhook route", () => {
  it("dispatches only after provider verification returns an event", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "channel-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.receive).toHaveBeenCalledWith("channel-1", { update_id: 7 }, "secret_123");
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ ok: true, eventId: "7", workflow: { runId: "run-1" } });
  });

  it("preserves provider-native verification failures", async () => {
    const { ChannelError } = await import("@/lib/channels");
    mocks.receive.mockRejectedValue(new ChannelError("invalid_webhook_signature", 401));
    const response = await POST(request(), { params: Promise.resolve({ id: "channel-1" }) });
    expect(response.status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

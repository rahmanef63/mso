import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ receive: vi.fn(), dispatch: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/host/rate-limit", () => ({ rateLimitedUntrusted: mocks.rate }));
vi.mock("../../workflow-runtime", () => ({ channelWorkflowRuntime: () => ({ scope: "exec", resolveTool: () => undefined }) }));
vi.mock("@/lib/channels", () => {
  class ChannelError extends Error {
    constructor(public readonly code: string, public readonly status = 400) { super(code); }
  }
  return { ChannelError, receiveDiscord: mocks.receive, dispatchChannelInbound: mocks.dispatch };
});

const { POST } = await import("./route");
const request = () => new NextRequest("https://mso.example.test/api/v1/channels/discord/channel-2", {
  method: "POST",
  headers: { "content-type": "application/json", "x-signature-timestamp": "1", "x-signature-ed25519": "aa".repeat(64) },
  body: JSON.stringify({ id: "1", type: 2 }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockReturnValue(false);
  mocks.receive.mockResolvedValue({ event: { provider: "discord", eventId: "1", kind: "command", receivedAt: new Date().toISOString(), raw: {} }, ping: false });
  mocks.dispatch.mockResolvedValue({ workflow: null });
});

describe("Discord interactions route", () => {
  it("returns Discord PONG without starting a workflow", async () => {
    mocks.receive.mockResolvedValue({ event: null, ping: true });
    const response = await POST(request(), { params: Promise.resolve({ id: "channel-2" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 1 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches verified non-PING interactions", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "channel-2" }) });
    expect(response.status).toBe(200);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ type: 4 });
  });
});

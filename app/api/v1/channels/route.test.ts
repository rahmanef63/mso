import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ role: null as null | string }));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => session.role ? { role: session.role, session: { device_id: "test-device" } } : null),
}));
vi.mock("@/lib/channels", () => ({
  ChannelError: class ChannelError extends Error {
    constructor(public readonly code: string, public readonly status = 400) { super(code); }
  },
  channelsSnapshot: vi.fn(async () => ({ version: 1, revision: 0, channels: [], credentials: [], providers: [] })),
  createChannelConfig: vi.fn(),
  updateChannelConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
  sendChannelText: vi.fn(),
  testChannel: vi.fn(),
}));

import { GET } from "./route";

describe("/api/v1/channels", () => {
  beforeEach(() => { session.role = null; });

  it("requires owner session before exposing channel metadata", async () => {
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "owner_required" });
  });

  it("returns the bounded metadata snapshot for owner", async () => {
    session.role = "owner";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 1, revision: 0, channels: [] });
  });
});

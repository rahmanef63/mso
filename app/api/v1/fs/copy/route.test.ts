import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getSessionActor: vi.fn(async () => "test-actor"),
  rateLimited: vi.fn(() => false),
  copy: vi.fn(async () => undefined),
  audit: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/fs-api", () => ({ copy: mocks.copy }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("https://mso.example/api/v1/fs/copy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("test-actor");
  mocks.rateLimited.mockReturnValue(false);
  mocks.copy.mockResolvedValue(undefined);
});

describe("POST /api/v1/fs/copy", () => {
  it("returns 401 when unauthenticated and does not call copy", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await post({ from: "a.txt", to: "b.txt" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not call copy", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await post({ from: "a.txt", to: "b.txt" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many copy requests, slow down" });
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    expect((await post({ to: "b.txt" })).status).toBe(400);
    expect((await post({ from: "a.txt" })).status).toBe(400);
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.copy.mockRejectedValue(new HostError("Path outside writable roots"));
    const res = await post({ from: "/etc/shadow", to: "/tmp/evil" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside writable roots" });
  });

  it("copies file successfully on happy path", async () => {
    const res = await post({ from: "source.txt", to: "dest.txt" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.copy).toHaveBeenCalledWith("source.txt", "dest.txt");
  });
});

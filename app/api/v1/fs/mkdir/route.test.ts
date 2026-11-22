import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getSessionActor: vi.fn(async () => "test-actor"),
  rateLimited: vi.fn(() => false),
  makeDir: vi.fn(async () => undefined),
  audit: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/fs-api", () => ({ makeDir: mocks.makeDir }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("https://mso.example/api/v1/fs/mkdir", {
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
  mocks.makeDir.mockResolvedValue(undefined);
});

describe("POST /api/v1/fs/mkdir", () => {
  it("returns 401 when unauthenticated and does not call makeDir", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await post({ path: "new-folder" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.makeDir).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not call makeDir", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await post({ path: "new-folder" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many mkdir requests, slow down" });
    expect(mocks.makeDir).not.toHaveBeenCalled();
  });

  it("returns 400 when path is missing or invalid", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ path: "" })).status).toBe(400);
    expect(mocks.makeDir).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.makeDir.mockRejectedValue(new HostError("Path outside writable roots"));
    const res = await post({ path: "/etc/evil" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside writable roots" });
  });

  it("creates directory successfully on happy path", async () => {
    const res = await post({ path: "valid-dir" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "dir" });
    expect(mocks.makeDir).toHaveBeenCalledWith("valid-dir");
  });
});

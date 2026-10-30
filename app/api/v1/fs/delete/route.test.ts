import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getSessionActor: vi.fn(async () => "test-actor"),
  rateLimited: vi.fn(() => false),
  remove: vi.fn(async () => undefined),
  audit: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/fs-api", () => ({ remove: mocks.remove }));

import { DELETE } from "./route";

const del = (body: unknown) =>
  DELETE(
    new Request("https://mso.example/api/v1/fs/delete", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("test-actor");
  mocks.rateLimited.mockReturnValue(false);
  mocks.remove.mockResolvedValue(undefined);
});

describe("DELETE /api/v1/fs/delete", () => {
  it("returns 401 when unauthenticated and does not call remove", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await del({ path: "target.txt" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not call remove", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await del({ path: "target.txt" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many delete requests, slow down" });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("returns 400 when path is missing or invalid", async () => {
    expect((await del({})).status).toBe(400);
    expect((await del({ path: "" })).status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.remove.mockRejectedValue(new HostError("Path outside writable roots"));
    const res = await del({ path: "/etc/passwd" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside writable roots" });
  });

  it("removes file successfully on happy path", async () => {
    const res = await del({ path: "clean-me.txt" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.remove).toHaveBeenCalledWith("clean-me.txt");
  });
});

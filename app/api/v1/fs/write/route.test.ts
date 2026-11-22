import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getSessionActor: vi.fn(async () => "test-actor"),
  rateLimited: vi.fn(() => false),
  writeFile: vi.fn(async () => undefined),
  audit: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/fs-api", () => ({ writeFile: mocks.writeFile }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("https://mso.example/api/v1/fs/write", {
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
  mocks.writeFile.mockResolvedValue(undefined);
});

describe("POST /api/v1/fs/write", () => {
  it("returns 401 when unauthenticated and does not call writeFile", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await post({ path: "test.txt", content: "data" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not call writeFile", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await post({ path: "test.txt", content: "data" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many write requests, slow down" });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("returns 400 when path or content is missing", async () => {
    expect((await post({ content: "data" })).status).toBe(400);
    expect((await post({ path: "" })).status).toBe(400);
    expect((await post({ path: "test.txt" })).status).toBe(400);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.writeFile.mockRejectedValue(new HostError("Path outside writable roots"));
    const res = await post({ path: "/etc/passwd", content: "evil" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside writable roots" });
  });

  it("writes file successfully on happy path with non-empty content", async () => {
    const res = await post({ path: "hello.txt", content: "world" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.writeFile).toHaveBeenCalledWith("hello.txt", "world");
  });

  it("writes file successfully on happy path with empty content", async () => {
    const res = await post({ path: "empty.txt", content: "" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.writeFile).toHaveBeenCalledWith("empty.txt", "");
  });
});

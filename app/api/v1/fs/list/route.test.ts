import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getSessionActor: vi.fn(async (): Promise<string | null> => "test-actor"),
  rateLimited: vi.fn(() => false),
  listDir: vi.fn(async () => []),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/fs-api", () => ({ listDir: mocks.listDir }));

import { GET } from "./route";

const get = (url = "https://mso.example/api/v1/fs/list") => GET(new Request(url));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("test-actor");
  mocks.rateLimited.mockReturnValue(false);
  mocks.listDir.mockResolvedValue([]);
});

describe("GET /api/v1/fs/list", () => {
  it("returns 401 when unauthenticated and does not call listDir", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("returns 401 when session actor is null and does not call listDir", async () => {
    mocks.getSessionActor.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not call listDir", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await get();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.listDir.mockRejectedValue(new HostError("Path outside readable roots"));
    const res = await get("https://mso.example/api/v1/fs/list?path=/etc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside readable roots" });
  });

  it("lists directory successfully on happy path with default path ~", async () => {
    const fixture = [{ name: "hello.txt", type: "file", size: 42 }];
    mocks.listDir.mockResolvedValue(fixture as never);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture);
    expect(mocks.listDir).toHaveBeenCalledWith("~", true, expect.anything());
  });

  it("passes custom path to listDir", async () => {
    mocks.listDir.mockResolvedValue([] as never);
    const res = await get("https://mso.example/api/v1/fs/list?path=subfolder");
    expect(res.status).toBe(200);
    expect(mocks.listDir).toHaveBeenCalledWith("subfolder", true, expect.anything());
  });
});

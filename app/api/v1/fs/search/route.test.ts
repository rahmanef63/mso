import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getSessionActor: vi.fn(async (): Promise<string | null> => "test-actor"),
  rateLimited: vi.fn(() => false),
  searchFs: vi.fn(async () => []),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/fs-api", () => ({ searchFs: mocks.searchFs }));

import { GET } from "./route";

const get = (url = "https://mso.example/api/v1/fs/search") => GET(new Request(url));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("test-actor");
  mocks.rateLimited.mockReturnValue(false);
  mocks.searchFs.mockResolvedValue([]);
});

describe("GET /api/v1/fs/search", () => {
  it("returns 401 when unauthenticated and does not call searchFs", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.searchFs).not.toHaveBeenCalled();
  });

  it("returns 401 when actor is null and does not call searchFs", async () => {
    mocks.getSessionActor.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.searchFs).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not call searchFs", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await get();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(mocks.searchFs).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.searchFs.mockRejectedValue(new HostError("Path outside readable roots"));
    const res = await get("https://mso.example/api/v1/fs/search?q=test&root=/etc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside readable roots" });
  });

  it("searches filesystem successfully on happy path", async () => {
    const fixture = [{ path: "test.txt", line: 1, text: "matched line" }];
    mocks.searchFs.mockResolvedValue(fixture as never);
    const res = await get("https://mso.example/api/v1/fs/search?q=matched&root=docs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture);
    expect(mocks.searchFs).toHaveBeenCalledWith("matched", expect.objectContaining({ root: "docs" }));
  });

  it("defaults query to empty string and root to undefined", async () => {
    mocks.searchFs.mockResolvedValue([] as never);
    const res = await get();
    expect(res.status).toBe(200);
    expect(mocks.searchFs).toHaveBeenCalledWith("", expect.objectContaining({ root: undefined }));
  });
});

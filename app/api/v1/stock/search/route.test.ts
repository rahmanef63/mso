import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  searchOpenverse: vi.fn(async () => [{ id: "ov-1", title: "Openverse Image" }]),
  searchUnsplash: vi.fn(async () => [{ id: "un-1", title: "Unsplash Image" }]),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/app/api/v1/stock/providers", () => ({
  searchOpenverse: mocks.searchOpenverse,
  searchUnsplash: mocks.searchUnsplash,
}));

import { GET } from "./route";

const originalKey = process.env.OS_UNSPLASH_ACCESS_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OS_UNSPLASH_ACCESS_KEY;
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.searchOpenverse.mockResolvedValue([{ id: "ov-1", title: "Openverse Image" }]);
  mocks.searchUnsplash.mockResolvedValue([{ id: "un-1", title: "Unsplash Image" }]);
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.OS_UNSPLASH_ACCESS_KEY;
  } else {
    process.env.OS_UNSPLASH_ACCESS_KEY = originalKey;
  }
});

describe("GET /api/v1/stock/search", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(new Request("https://mso.example/api/v1/stock/search?q=cat"));
    expect(res.status).toBe(401);
    expect(mocks.searchOpenverse).not.toHaveBeenCalled();
    expect(mocks.searchUnsplash).not.toHaveBeenCalled();
  });

  it("returns 400 when query parameter q is missing or empty", async () => {
    expect((await GET(new Request("https://mso.example/api/v1/stock/search"))).status).toBe(400);
    expect((await GET(new Request("https://mso.example/api/v1/stock/search?q=%20"))).status).toBe(400);
    expect(mocks.searchOpenverse).not.toHaveBeenCalled();
  });

  it("falls back to Openverse when no Unsplash key is configured", async () => {
    const res = await GET(new Request("https://mso.example/api/v1/stock/search?q=forest&page=2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ id: "ov-1", title: "Openverse Image" }] });
    expect(mocks.searchOpenverse).toHaveBeenCalledWith("forest", 2);
    expect(mocks.searchUnsplash).not.toHaveBeenCalled();
  });

  it("routes search to Unsplash when OS_UNSPLASH_ACCESS_KEY is present", async () => {
    process.env.OS_UNSPLASH_ACCESS_KEY = "test-key";
    const res = await GET(new Request("https://mso.example/api/v1/stock/search?q=mountains"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ id: "un-1", title: "Unsplash Image" }] });
    expect(mocks.searchUnsplash).toHaveBeenCalledWith("mountains", 1, "test-key");
    expect(mocks.searchOpenverse).not.toHaveBeenCalled();
  });

  it("returns 502 when upstream provider search throws", async () => {
    mocks.searchOpenverse.mockRejectedValue(new Error("upstream timeout"));
    const res = await GET(new Request("https://mso.example/api/v1/stock/search?q=ocean"));
    expect(res.status).toBe(502);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  usage: vi.fn(async () => ({ used: 1024, total: 4096 })),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/host/fs-api", () => ({ usage: mocks.usage }));

import { GET } from "./route";

const get = (url = "https://mso.example/api/v1/fs/usage") => GET(new Request(url));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.usage.mockResolvedValue({ used: 1024, total: 4096 });
});

describe("GET /api/v1/fs/usage", () => {
  it("returns 401 when unauthenticated and does not call usage", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.usage.mockRejectedValue(new HostError("Path outside readable roots"));
    const res = await get("https://mso.example/api/v1/fs/usage?path=/etc/shadow");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside readable roots" });
    expect(mocks.usage).toHaveBeenCalledWith("/etc/shadow");
  });

  it("returns 404 when requested path does not exist", async () => {
    const enoent = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";
    mocks.usage.mockRejectedValue(enoent);
    const res = await get("https://mso.example/api/v1/fs/usage?path=nonexistent");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("defaults to ~ when path parameter is omitted", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ used: 1024, total: 4096 });
    expect(mocks.usage).toHaveBeenCalledWith("~");
  });

  it("reads usage for a custom valid path", async () => {
    mocks.usage.mockResolvedValue({ used: 500, total: 2000 });
    const res = await get("https://mso.example/api/v1/fs/usage?path=workspace/proj");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ used: 500, total: 2000 });
    expect(mocks.usage).toHaveBeenCalledWith("workspace/proj");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "dev-1" as string | null),
  rateLimited: vi.fn(() => false),
  readFile: vi.fn(async () => "file-content"),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/host/fs-api", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));

import { GET } from "./route";

const get = (url = "https://mso.example/api/v1/fs/read") => GET(new Request(url));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.actor.mockResolvedValue("dev-1");
  mocks.rateLimited.mockReturnValue(false);
  mocks.readFile.mockResolvedValue("file-content");
});

describe("GET /api/v1/fs/read", () => {
  it("returns 401 when unauthenticated and does not call readFile", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.readFile.mockRejectedValue(new HostError("Path outside readable roots"));
    const res = await get("https://mso.example/api/v1/fs/read?path=/etc/shadow");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside readable roots" });
  });

  it("refuses files exceeding size limit with 400", async () => {
    mocks.readFile.mockRejectedValue(new HostError("File too large to read (max 5 MiB)"));
    const res = await get("https://mso.example/api/v1/fs/read?path=huge.bin");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "File too large to read (max 5 MiB)" });
  });

  it("reads file successfully on happy path with default path ~", async () => {
    mocks.readFile.mockResolvedValue("default content");
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toBe("default content");
    expect(mocks.readFile).toHaveBeenCalledWith("~");
  });

  it("returns 429 when rate limited and does not read", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await get();
    expect(res.status).toBe(429);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("passes custom path to readFile", async () => {
    mocks.readFile.mockResolvedValue("custom content");
    const res = await get("https://mso.example/api/v1/fs/read?path=workspace/notes.txt");
    expect(res.status).toBe(200);
    expect(await res.json()).toBe("custom content");
    expect(mocks.readFile).toHaveBeenCalledWith("workspace/notes.txt");
  });
});

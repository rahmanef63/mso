import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  getSessionActor: vi.fn(async () => "test-actor"),
  rateLimited: vi.fn(() => false),
  zipStream: vi.fn(async () => Readable.from([Buffer.from("PK-fake-zip")])),
  audit: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/fs-api", () => ({ zipStream: mocks.zipStream }));

import { GET } from "./route";

const get = (url: string) => GET(new Request(url));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("test-actor");
  mocks.rateLimited.mockReturnValue(false);
  mocks.zipStream.mockResolvedValue(Readable.from([Buffer.from("PK-fake-zip")]));
});

describe("GET /api/v1/fs/zip", () => {
  it("returns 401 when unauthenticated and does not call zipStream", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await get("https://mso.example/api/v1/fs/zip?base=workspace&n=file1.txt");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.zipStream).not.toHaveBeenCalled();
    expect(mocks.rateLimited).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and audits refusal", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await get("https://mso.example/api/v1/fs/zip?base=workspace&n=file1.txt");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many download requests, slow down" });
    expect(mocks.zipStream).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith({
      action: "fs.zip",
      actor: "test-actor",
      ok: false,
      detail: "rate-limited",
    });
  });

  it("returns 400 when base is missing or empty", async () => {
    const res = await get("https://mso.example/api/v1/fs/zip?n=file1.txt");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "base + n required" });
    expect(mocks.zipStream).not.toHaveBeenCalled();
  });

  it("returns 400 when n parameter is missing", async () => {
    const res = await get("https://mso.example/api/v1/fs/zip?base=workspace");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "base + n required" });
    expect(mocks.zipStream).not.toHaveBeenCalled();
  });

  it("refuses path that escapes allowed roots with 400", async () => {
    mocks.zipStream.mockRejectedValue(new HostError("Path outside readable roots"));
    const res = await get("https://mso.example/api/v1/fs/zip?base=/etc&n=passwd");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside readable roots" });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fs.zip", ok: false, target: "/etc" }),
    );
  });

  it("refuses selections exceeding selection or size limits with 400", async () => {
    mocks.zipStream.mockRejectedValue(new HostError("Archive exceeds 512 MiB input limit"));
    const res = await get("https://mso.example/api/v1/fs/zip?base=workspace&n=huge.bin");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Archive exceeds 512 MiB input limit" });
  });

  it("streams zip archive successfully on happy path with default filename", async () => {
    const res = await get("https://mso.example/api/v1/fs/zip?base=workspace&n=file1.txt&n=file2.txt&x=node_modules");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="archive.zip"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.zipStream).toHaveBeenCalledWith("workspace", ["file1.txt", "file2.txt"], ["node_modules"]);
    expect(mocks.audit).toHaveBeenCalledWith({
      action: "fs.zip",
      actor: "test-actor",
      target: "workspace",
      ok: true,
      detail: "2 items, skip 1",
    });
  });

  it("sanitizes custom filename to prevent header injection or unsafe paths", async () => {
    const res = await get("https://mso.example/api/v1/fs/zip?base=workspace&n=file.txt&name=my%20archive/../$test.zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="my_archive_.._test.zip"');
  });
});

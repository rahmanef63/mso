import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readFileBytes: vi.fn(async () => Buffer.from([0x50,0x4b,0x05,0x06, ...new Array(18).fill(0)])),
  mimeFor: vi.fn(() => "application/zip"),
  createMcpFileResource: vi.fn(async () => ({
    id: "abc", uri: "mso-file:///aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    filename: "archive.zip", mimeType: "application/zip", sha256: "a".repeat(64), bytes: 22,
    createdAt: 1, expiresAt: 901000, readsLeft: 5,
  })),
  createTempShare: vi.fn(async () => ({
    id: "abcdefghijklmnopqrstuvwxyzABCDEF", name: "archive.zip", mimeType: "application/zip",
    createdAt: 1, expiresAt: 901000, downloadsLeft: 5, bytes: 22,
  })),
  tempShareUrl: vi.fn((id: string, download = false) => `https://mso.example.test/api/v1/temp-share/${id}${download ? "?download=1" : ""}`),
}));
vi.mock("@/lib/host/fs-api", async (orig) => {
  const real = await orig<typeof import("@/lib/host/fs-api")>();
  return { ...real, readFileBytes: mocks.readFileBytes, mimeFor: mocks.mimeFor };
});
vi.mock("@/lib/host/temp-share-api", () => ({ createTempShare: mocks.createTempShare, tempShareUrl: mocks.tempShareUrl }));
vi.mock("./file-transfer-resource", () => ({ createMcpFileResource: mocks.createMcpFileResource }));

const { FILE_TRANSFER_READ_TOOLS } = await import("./tools-file-transfer");
describe("fs_export_file", () => {
  it("returns an owner-bound MCP resource link and separate browser fallback", async () => {
    const tool = FILE_TRANSFER_READ_TOOLS.find((row) => row.name === "fs_export_file")!;
    const result = await tool.run({ path: "/home/example/archive.zip" }, { scope: "read", principal: "alice", sessionId: "session-a" }) as any;
    expect(mocks.createMcpFileResource).toHaveBeenCalledWith(expect.objectContaining({ principal: "alice", sessionId: "session-a", filename: "archive.zip" }));
    expect(result.content[0]).toMatchObject({
      type: "resource_link", uri: "mso-file:///aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "archive.zip", mimeType: "application/zip",
    });
    expect(result.structuredContent.result).toMatchObject({
      resourceUri: "mso-file:///aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      browserDownloadUrl: "https://mso.example.test/api/v1/temp-share/abcdefghijklmnopqrstuvwxyzABCDEF?download=1",
    });
  });
  it("requires an authenticated MCP principal", async () => {
    const tool = FILE_TRANSFER_READ_TOOLS.find((row) => row.name === "fs_export_file")!;
    await expect(tool.run({ path: "/home/example/archive.zip" }, { scope: "read" })).rejects.toThrow(/principal/i);
  });
});

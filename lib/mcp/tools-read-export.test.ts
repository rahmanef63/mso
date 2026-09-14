import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readFileBytes: vi.fn(async () => Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02])),
  mimeFor: vi.fn(() => "application/zip"),
  createTempShare: vi.fn(async () => ({
    id: "abcdefghijklmnopqrstuvwxyzABCDEF",
    name: "archive.zip",
    mimeType: "application/zip",
    createdAt: 1,
    expiresAt: 901_000,
    downloadsLeft: 5,
    bytes: 6,
  })),
  tempShareUrl: vi.fn((id: string, download = false) => `https://mso.example.test/api/v1/temp-share/${id}${download ? "?download=1" : ""}`),
}));

vi.mock("@/lib/host/fs-api", async (orig) => {
  const real = await orig<typeof import("@/lib/host/fs-api")>();
  return { ...real, readFileBytes: mocks.readFileBytes, mimeFor: mocks.mimeFor };
});
vi.mock("@/lib/host/temp-share-api", () => ({ createTempShare: mocks.createTempShare, tempShareUrl: mocks.tempShareUrl }));

const { FILE_TRANSFER_READ_TOOLS } = await import("./tools-file-transfer");

describe("fs_export_file", () => {
  it("returns an authenticated original-byte resource link plus checksum metadata", async () => {
    const tool = FILE_TRANSFER_READ_TOOLS.find((row) => row.name === "fs_export_file");
    expect(tool).toBeDefined();
    expect(tool?.scope).toBe("read");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });

    const result = await tool!.run({ path: "/home/example/archive.zip" }, { scope: "read" }) as {
      __mcpDirect: true;
      content: Array<Record<string, unknown>>;
      structuredContent?: { result?: Record<string, unknown> };
    };
    expect(mocks.readFileBytes).toHaveBeenCalledWith("/home/example/archive.zip", 10 * 1024 * 1024);
    expect(mocks.createTempShare).toHaveBeenCalledWith(expect.objectContaining({
      filename: "archive.zip",
      mimeType: "application/zip",
      ttlMs: 15 * 60_000,
      maxDownloads: 5,
    }));
    expect(result.content[0]).toMatchObject({
      type: "resource_link",
      uri: "https://mso.example.test/api/v1/temp-share/abcdefghijklmnopqrstuvwxyzABCDEF?download=1",
      name: "archive.zip",
      mimeType: "application/zip",
    });
    expect(result.structuredContent?.result).toMatchObject({
      filename: "archive.zip",
      mimeType: "application/zip",
      bytes: 6,
      sha256: "72ddd979de80b61ca55ce309f4c2a029c78a7ef9b6259e0a3d5e17a191a4cfdf",
      downloadsLeft: 5,
    });
  });
});

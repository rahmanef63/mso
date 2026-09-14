type FsApiModule = typeof import("@/lib/host/fs-api");
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const uploadOneGuarded = vi.fn(async (input: Record<string, unknown>) => ({
  path: `/home/example/${String(input.filename)}`, filename: String(input.filename),
  status: "created", sha256: "a".repeat(64),
}));
vi.mock("@/lib/host/fs-api", async (orig) => {
  const real = await orig<FsApiModule>();
  return { ...real, uploadOneGuarded };
});

const { importOpenAiProvidedFile } = await import("./openai-file-upload");
let PNG: Buffer;
const JSON_BYTES = new TextEncoder().encode('{"ok":true}');
const ZIP = Uint8Array.from([0x50,0x4b,0x05,0x06,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);

beforeAll(async () => {
  PNG = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
});
beforeEach(() => {
  uploadOneGuarded.mockClear();
  delete process.env.OS_MCP_OPENAI_FILE_HOSTS;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(PNG), { status: 200, headers: { "content-type": "image/png" } })));
});
afterEach(() => vi.unstubAllGlobals());

const call = (file: Record<string, unknown>) => importOpenAiProvidedFile({
  file: { download_url: "https://files.oaiusercontent.com/file.png", file_id: "file_test", file_name: "file.png", ...file },
  dest: "/home/example/generated-files",
});

describe("ChatGPT transfer regression boundaries", () => {
  it("trusts oaiusercontent and rejects malformed Azure allowlist entries fail-closed", async () => {
    await expect(call({ mime_type: "image/png" })).resolves.toMatchObject({ mimeType: "image/png" });
    process.env.OS_MCP_OPENAI_FILE_HOSTS = "*.blob.core.windows.net";
    await expect(call({ download_url: "https://oaisdmntprseasia.blob.core.windows.net/file.png", mime_type: "image/png" })).rejects.toThrow(/invalid Azure Blob hostname/i);
  });

  it("allows the rotating Azure family only when OAuth provenance marks ChatGPT fileParams", async () => {
    const file = { download_url: "https://oaisdmntprindiasocentral.blob.core.windows.net/file.png", file_id: "file_test", file_name: "file.png", mime_type: "image/png" };
    await expect(importOpenAiProvidedFile({ file, dest: "/home/example/generated-files" })).rejects.toThrow(/host is not allowed/i);
    await expect(importOpenAiProvidedFile({ file, dest: "/home/example/generated-files", allowChatGptAzureFamily: true })).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("rejects redirects to untrusted hosts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://attacker.blob.core.windows.net/file.png" } })));
    await expect(call({ mime_type: "image/png" })).rejects.toThrow(/host is not allowed/i);
    expect(uploadOneGuarded).not.toHaveBeenCalled();
  });

  it("allows redirects only to an exact configured Azure host", async () => {
    process.env.OS_MCP_OPENAI_FILE_HOSTS = "oaisdmntprseasia.blob.core.windows.net";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://oaisdmntprseasia.blob.core.windows.net/file.png" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(PNG), { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(call({ mime_type: "image/png" })).resolves.toMatchObject({ mimeType: "image/png" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes ZIP MIME and can infer supported MIME from filename", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(ZIP, { status: 200, headers: { "content-type": "application/x-zip-compressed" } })));
    await expect(call({ mime_type: "application/x-zip-compressed", file_name: "file.zip" })).resolves.toMatchObject({ mimeType: "application/zip" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON_BYTES, { status: 200, headers: { "content-type": "application/octet-stream" } })));
    await expect(call({ mime_type: undefined, file_name: "data.json" })).resolves.toMatchObject({ mimeType: "application/json" });
  });

  it("does not let declared octet-stream bypass the allowlisted type matrix", async () => {
    await expect(call({ mime_type: "application/octet-stream", file_name: "file.bin" })).rejects.toThrow(/unsupported file type/i);
    expect(uploadOneGuarded).not.toHaveBeenCalled();
  });

  it("rejects a conflicting trusted response MIME", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON_BYTES, { status: 200, headers: { "content-type": "application/json" } })));
    await expect(call({ mime_type: "image/png", file_name: "file.png" })).rejects.toThrow(/does not match image\/png/i);
  });

  it("rejects declared sizes beyond the 20 MiB transfer cap before download", async () => {
    await expect(call({ mime_type: "image/png", size: 20 * 1024 * 1024 + 1 })).rejects.toThrow(/20 MiB/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

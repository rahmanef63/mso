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
let PNG: Buffer, JPEG: Buffer, WEBP: Buffer;
const JSON_BYTES = Buffer.from('{"ok":true}');
const ZIP = Buffer.from([0x50,0x4b,0x05,0x06,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);

beforeAll(async () => {
  const source = { create: { width: 2, height: 2, channels: 4 as const, background: { r: 4, g: 8, b: 12, alpha: 0.5 } } };
  PNG = await sharp(source).png().toBuffer();
  JPEG = await sharp(source).jpeg().toBuffer();
  WEBP = await sharp(source).webp({ lossless: true }).toBuffer();
});
beforeEach(() => {
  uploadOneGuarded.mockClear();
  delete process.env.OS_MCP_OPENAI_FILE_HOSTS;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(PNG), { status: 200, headers: { "content-type": "image/png" } })));
});
afterEach(() => vi.unstubAllGlobals());

function run(file: Record<string, unknown>, options: Record<string, unknown> = {}) {
  return importOpenAiProvidedFile({
    file: { download_url: "https://files.oaiusercontent.com/file", file_id: "file_test", file_name: "file.png", ...file },
    dest: "/home/example/generated-files", ...options,
  });
}

describe("ChatGPT upload trust and validation", () => {
  it("requires exact Azure host allowlisting", async () => {
    await expect(run({ download_url: "https://oaisdmntprseasia.blob.core.windows.net/f.png", mime_type: "image/png" })).rejects.toThrow(/host is not allowed/i);
    process.env.OS_MCP_OPENAI_FILE_HOSTS = "oaisdmntprseasia.blob.core.windows.net";
    await expect(run({ download_url: "https://oaisdmntprseasia.blob.core.windows.net/f.png", mime_type: "image/png" })).resolves.toMatchObject({ mimeType: "image/png" });
  });
  it.each([
    ["image/png", "file.png", () => PNG],
    ["image/jpeg", "file.jpg", () => JPEG],
    ["image/webp", "file.webp", () => WEBP],
    ["application/json", "file.json", () => JSON_BYTES],
    ["application/zip", "file.zip", () => ZIP],
  ])("accepts fully valid %s", async (mimeType, fileName, bytes) => {
    const data = bytes();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(data), { status: 200, headers: { "content-type": mimeType } })));
    await expect(run({ mime_type: mimeType, file_name: fileName }, { filename: fileName })).resolves.toMatchObject({ mimeType });
  });
  it("rejects magic-only corrupt raster data", async () => {
    const corrupt = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(corrupt), { status: 200, headers: { "content-type": "image/png" } })));
    await expect(run({ mime_type: "image/png" })).rejects.toThrow(/content does not match/i);
  });
  it("rejects malformed ZIP without an end-of-central-directory record", async () => {
    const bad = Buffer.from([0x50,0x4b,0x03,0x04,0,0,0,0]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bad), { status: 200, headers: { "content-type": "application/zip" } })));
    await expect(run({ mime_type: "application/zip", file_name: "file.zip" }, { filename: "file.zip" })).rejects.toThrow(/content does not match/i);
  });
  it("rejects invalid JSON and mismatched filename extension", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(Buffer.from("{bad")), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(run({ mime_type: "application/json", file_name: "file.json" }, { filename: "file.json" })).rejects.toThrow(/content does not match/i);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(PNG), { status: 200, headers: { "content-type": "image/png" } })));
    await expect(run({ mime_type: "image/png", file_name: "file.png" }, { filename: "wrong.zip" })).rejects.toThrow(/extension/i);
  });
  it("forwards guarded conflict and expected hash semantics", async () => {
    await run({ mime_type: "image/png" }, { filename: "file.png", conflict: "replace", expectedSha256: "b".repeat(64) });
    expect(uploadOneGuarded).toHaveBeenCalledWith(expect.objectContaining({ conflict: "replace", expectedSha256: "b".repeat(64) }));
  });
  it("stops a chunked response over 20 MiB", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (let i=0;i<21;i++) controller.enqueue(chunk); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "image/png" } })));
    await expect(run({ mime_type: "image/png" })).rejects.toThrow(/20 MiB/i);
    expect(uploadOneGuarded).not.toHaveBeenCalled();
  });
});

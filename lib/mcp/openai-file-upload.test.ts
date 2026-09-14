type FsApiModule = typeof import("@/lib/host/fs-api");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const uploadInto = vi.fn(async () => ({ written: 1, failed: [] as string[] }));
vi.mock("@/lib/host/fs-api", async (orig) => {
  const real = await orig<FsApiModule>();
  return { ...real, uploadInto };
});

const { importOpenAiProvidedFile } = await import("./openai-file-upload");

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
const WEBP = new TextEncoder().encode("RIFF0000WEBP");
const JSON_BYTES = new TextEncoder().encode('{"ok":true}');
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00]);

beforeEach(() => {
  uploadInto.mockClear();
  delete process.env.OS_MCP_OPENAI_FILE_HOSTS;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG, {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(PNG.byteLength) },
  })));
});
afterEach(() => vi.unstubAllGlobals());

function importFile(input: {
  download_url?: string;
  file_id?: string;
  mime_type?: string;
  file_name?: string;
  size?: number;
}, allowChatGptAzureFamily = false) {
  return importOpenAiProvidedFile({
    file: {
      download_url: input.download_url || "https://files.oaiusercontent.com/file",
      file_id: input.file_id || "file_test",
      mime_type: input.mime_type,
      file_name: input.file_name || "file.png",
      size: input.size,
    },
    dest: "/home/example/generated-files",
    allowChatGptAzureFamily,
  });
}

describe("ChatGPT file host allowlist", () => {
  it("accepts OpenAI oaiusercontent content hosts by default", async () => {
    await expect(importFile({ download_url: "https://files.oaiusercontent.com/file.png", mime_type: "image/png" })).resolves.toMatchObject({ bytes: 8 });
  });

  it.each(["oaisdmntprkoreacentral.blob.core.windows.net", "oaisdmntprjapaneast.blob.core.windows.net"])
    ("accepts rotating ChatGPT Azure host %s only with trusted fileParams provenance", async (host) => {
      await expect(importFile({ download_url: `https://${host}/container/file.png?sig=redacted`, mime_type: "image/png" }, true))
        .resolves.toMatchObject({ bytes: 8 });
    });


  it("rejects Azure account-name prefixes unless the exact host is configured", async () => {
    await expect(importFile({ download_url: "https://oaisdmntprseasia.blob.core.windows.net/container/file.png", mime_type: "image/png" }))
      .rejects.toThrow("host is not allowed");
  });

  it("accepts only an exact configured Azure Blob hostname", async () => {
    process.env.OS_MCP_OPENAI_FILE_HOSTS = "oaisdmntprseasia.blob.core.windows.net";
    await expect(importFile({ download_url: "https://oaisdmntprseasia.blob.core.windows.net/container/file.png?sig=redacted", mime_type: "image/png" }))
      .resolves.toMatchObject({ bytes: 8 });
    await expect(importFile({ download_url: "https://oaisdmntprfuture123.blob.core.windows.net/container/file.png", mime_type: "image/png" }))
      .rejects.toThrow("host is not allowed");
  });

  it("rejects malformed configured Azure host entries fail-closed", async () => {
    process.env.OS_MCP_OPENAI_FILE_HOSTS = "*.blob.core.windows.net";
    await expect(importFile({ download_url: "https://files.oaiusercontent.com/file.png", mime_type: "image/png" }))
      .resolves.toMatchObject({ bytes: 8 });
    await expect(importFile({ download_url: "https://oaisdmntprseasia.blob.core.windows.net/file.png", mime_type: "image/png" }))
      .rejects.toThrow("invalid Azure Blob hostname");
  });

  it("rejects a redirect from an allowed OpenAI host to an unconfigured Azure host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.blob.core.windows.net/container/file.png" },
    })));
    await expect(importFile({ download_url: "https://files.oaiusercontent.com/start/file.png", mime_type: "image/png" }))
      .rejects.toThrow("host is not allowed: attacker.blob.core.windows.net");
  });

  it("keeps the ChatGPT Azure exception scoped to the oaisdmntpr account family", async () => {
    await expect(importFile({ download_url: "https://attacker.blob.core.windows.net/container/file.png?sig=redacted", mime_type: "image/png" }, true))
      .rejects.toThrow("host is not allowed");
  });


  it("allows a redirect to an exact configured Azure host", async () => {
    process.env.OS_MCP_OPENAI_FILE_HOSTS = "oaisdmntprseasia.blob.core.windows.net";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://oaisdmntprseasia.blob.core.windows.net/container/file.png?sig=next" },
      }))
      .mockResolvedValueOnce(new Response(PNG, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "8" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(importFile({ download_url: "https://files.oaiusercontent.com/start/file.png", mime_type: "image/png" })).resolves.toMatchObject({ bytes: 8 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("explicit ChatGPT file MIME matrix", () => {
  it.each([
    ["image/png", "file.png", PNG],
    ["image/jpeg", "file.jpg", JPEG],
    ["image/webp", "file.webp", WEBP],
    ["application/json", "file.json", JSON_BYTES],
    ["application/zip", "file.zip", ZIP],
  ])("accepts %s with matching content", async (mimeType, fileName, data) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(data, {
      status: 200,
      headers: { "content-type": mimeType, "content-length": String(data.byteLength) },
    })));
    await expect(importFile({ mime_type: mimeType, file_name: fileName, size: data.byteLength })).resolves.toMatchObject({ mimeType, bytes: data.byteLength });
  });

  it("normalizes the common ZIP MIME alias", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(ZIP, {
      status: 200,
      headers: { "content-type": "application/x-zip-compressed" },
    })));
    await expect(importFile({ mime_type: "application/x-zip-compressed", file_name: "file.zip" })).resolves.toMatchObject({ mimeType: "application/zip" });
  });

  it("infers a supported type from the filename when ChatGPT omits mime_type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON_BYTES, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    })));
    await expect(importFile({ file_name: "data.json" })).resolves.toMatchObject({ mimeType: "application/json" });
  });

  it("rejects generic declared octet-stream instead of bypassing the matrix", async () => {
    await expect(importFile({ mime_type: "application/octet-stream", file_name: "file.bin" })).rejects.toThrow("unsupported file type");
    expect(uploadInto).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new TextEncoder().encode("{broken"), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    await expect(importFile({ mime_type: "application/json", file_name: "file.json" })).rejects.toThrow("content does not match application/json");
  });

  it("rejects invalid ZIP content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new TextEncoder().encode("not zip"), {
      status: 200,
      headers: { "content-type": "application/zip" },
    })));
    await expect(importFile({ mime_type: "application/zip", file_name: "file.zip" })).rejects.toThrow("content does not match application/zip");
  });

  it("rejects a conflicting trusted response MIME", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JPEG, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    })));
    await expect(importFile({ mime_type: "image/png", file_name: "file.png" })).rejects.toThrow("does not match image/png");
  });

  it("stops a chunked response at 20 MiB even without Content-Length", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 21; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "image/png" },
    })));
    await expect(importFile({ mime_type: "image/png", file_name: "large.png" })).rejects.toThrow("exceeds the 20 MiB MCP import limit");
    expect(uploadInto).not.toHaveBeenCalled();
  });
});

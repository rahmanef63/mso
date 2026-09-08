import { describe, expect, it } from "vitest";
import { boundaryFromContentType, parseMultipart, UploadTooLargeError } from "./multipart";

const enc = new TextEncoder();
const MiB = 1024 * 1024;

// A ReadableStream that emits `bytes` in small chunks, so the parser's internal
// pull()/accumulation path is exercised exactly as it is against a real body.
function streamOf(bytes: Uint8Array, chunkSize = 512): ReadableStream<Uint8Array> {
  let off = 0;
  return new ReadableStream({
    pull(controller) {
      if (off >= bytes.length) return controller.close();
      const end = Math.min(off + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(off, end));
      off = end;
    },
  });
}

function buildBody(
  boundary: string,
  parts: Array<{ name: string; filename?: string; body: string }>,
): Uint8Array {
  let s = "";
  for (const p of parts) {
    s += `--${boundary}\r\n`;
    let cd = `Content-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) cd += `; filename="${p.filename}"`;
    s += `${cd}\r\n\r\n${p.body}\r\n`;
  }
  s += `--${boundary}--\r\n`;
  return enc.encode(s);
}

// Drain every part fully (the parser REQUIRES each body be consumed before the
// next part), returning decoded parts.
async function collect(bytes: Uint8Array, boundary: string, limit: number) {
  const out: Array<{ name: string; filename?: string; body: string }> = [];
  for await (const part of parseMultipart(streamOf(bytes), boundary, limit)) {
    const chunks: Uint8Array[] = [];
    for await (const c of part.body) chunks.push(c);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      merged.set(c, o);
      o += c.length;
    }
    out.push({ name: part.name, filename: part.filename, body: new TextDecoder().decode(merged) });
  }
  return out;
}

describe("boundaryFromContentType", () => {
  it("reads quoted and unquoted boundary", () => {
    expect(boundaryFromContentType('multipart/form-data; boundary="abc123"')).toBe("abc123");
    expect(boundaryFromContentType("multipart/form-data; boundary=xy-zZ")).toBe("xy-zZ");
  });
  it("throws when boundary is missing or header is null", () => {
    expect(() => boundaryFromContentType("multipart/form-data")).toThrow();
    expect(() => boundaryFromContentType(null)).toThrow();
  });
});

describe("parseMultipart", () => {
  it("parses a dest field + a file part with its filename/relPath", async () => {
    const body = buildBody("B0", [
      { name: "dest", body: "/home/operator/up" },
      { name: "file", filename: "docs/a.txt", body: "hello world" },
    ]);
    const parts = await collect(body, "B0", 10 * MiB);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ name: "dest", body: "/home/operator/up" });
    expect(parts[1]).toMatchObject({ name: "file", filename: "docs/a.txt", body: "hello world" });
  });

  it("throws UploadTooLargeError once a part body exceeds the running cap", async () => {
    const body = buildBody("B1", [{ name: "file", filename: "big.bin", body: "A".repeat(4096) }]);
    await expect(collect(body, "B1", 1024)).rejects.toBeInstanceOf(UploadTooLargeError);
  });

  // The bypass the wave-1 QA flagged: the cap only counted PART-BODY bytes, so a
  // body-less stream that just grows `buf` could OOM. These two assert the raw
  // pull() backstop now caps preamble + header growth too.
  it("caps an oversized preamble that never reaches a boundary (no OOM/hang)", async () => {
    const evil = enc.encode("A".repeat(4096)); // no `--boundary` anywhere
    await expect(collect(evil, "B2", 1024)).rejects.toBeInstanceOf(UploadTooLargeError);
  });

  it("caps an oversized part header block with no CRLFCRLF terminator", async () => {
    const evil = enc.encode(`--B3\r\n${"H".repeat(4096)}`); // header never ends
    await expect(collect(evil, "B3", 1024)).rejects.toBeInstanceOf(UploadTooLargeError);
  });
});

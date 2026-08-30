import { createHash } from "crypto";
import path from "path";
import { HostError, uploadInto } from "@/lib/host";

export interface OpenAiProvidedFile {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
  name?: string;
  size?: number;
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/webp", "image/jpeg", "application/octet-stream"]);

function providedFile(value: unknown): OpenAiProvidedFile {
  if (!value || typeof value !== "object") throw new HostError("file must be a ChatGPT-provided file object");
  const row = value as Partial<OpenAiProvidedFile>;
  if (typeof row.download_url !== "string" || !row.download_url) throw new HostError("file.download_url is missing");
  if (typeof row.file_id !== "string" || !row.file_id) throw new HostError("file.file_id is missing");
  return row as OpenAiProvidedFile;
}

function trustedDownloadUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HostError("file.download_url is invalid"); }
  if (url.protocol !== "https:") throw new HostError("file.download_url must use HTTPS");
  const host = url.hostname.toLowerCase();

  // ChatGPT temporary files are served either from oaiusercontent.com or from
  // OpenAI-owned Azure Storage accounts whose globally unique account name uses
  // the stable `oaisdmntpr<region>` prefix. Match that account family rather than
  // enumerating regions, but never accept arbitrary *.blob.core.windows.net hosts.
  // Azure storage account names are globally unique, so an unrelated tenant cannot
  // create another account with the same full account name.
  const openAiAzureBlobHost = /^oaisdmntpr[a-z0-9]{2,40}\.blob\.core\.windows\.net$/;
  const openAiContentHost = host === "files.oaiusercontent.com" || host.endsWith(".oaiusercontent.com");
  if (!openAiContentHost && !openAiAzureBlobHost.test(host)) {
    throw new HostError(`file.download_url host is not allowed: ${host}`);
  }
  return url;
}

async function fetchTrustedFile(initialUrl: URL): Promise<Response> {
  let url = initialUrl;
  for (let hop = 0; hop <= 3; hop += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: { accept: "image/png,image/webp,image/jpeg,application/octet-stream" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new HostError("OpenAI file redirect was missing a location");
    url = trustedDownloadUrl(new URL(location, url).toString());
  }
  throw new HostError("OpenAI file download exceeded the redirect limit");
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    const declared = Number(rawLength);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_FILE_BYTES) {
      throw new HostError("file exceeds the 20 MiB MCP import limit");
    }
  }
  if (!response.body) throw new HostError("OpenAI file download was empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FILE_BYTES) {
        await reader.cancel("MCP import size limit exceeded").catch(() => {});
        throw new HostError("file exceeds the 20 MiB MCP import limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes === 0) throw new HostError("OpenAI file download was empty");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes);
}

function responseMime(response: Response): string | null {
  const value = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!value) return null;
  if (!ALLOWED_MIME.has(value)) throw new HostError(`unsupported response file type: ${value}`);
  return value;
}

function hasExpectedSignature(data: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === "image/webp") return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  return true; // application/octet-stream is intentionally a generic file bridge.
}

function safeFilename(input: string | undefined, fallback: string): string {
  const value = path.basename((input || fallback).trim());
  if (!value || value === "." || value === ".." || value.length > 200) throw new HostError("filename is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new HostError("filename may contain only letters, digits, dot, dash and underscore");
  return value;
}

export async function importOpenAiProvidedFile(opts: {
  file: unknown;
  dest: string;
  filename?: string;
}): Promise<{
  ok: true;
  fileId: string;
  path: string;
  filename: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}> {
  const file = providedFile(opts.file);
  const url = trustedDownloadUrl(file.download_url);
  const mimeType = (file.mime_type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new HostError(`unsupported file type: ${mimeType}`);
  if (typeof file.size === "number" && (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES)) {
    throw new HostError("file exceeds the 20 MiB MCP import limit");
  }

  const response = await fetchTrustedFile(url);
  if (!response.ok) throw new HostError(`OpenAI file download failed (${response.status})`);
  const wireMime = responseMime(response);
  if (
    mimeType !== "application/octet-stream" &&
    wireMime &&
    wireMime !== "application/octet-stream" &&
    wireMime !== mimeType
  ) {
    throw new HostError(`response file type ${wireMime} does not match ${mimeType}`);
  }
  const data = await readBoundedBody(response);
  const effectiveMime = mimeType === "application/octet-stream" ? (wireMime || mimeType) : mimeType;
  if (!hasExpectedSignature(data, effectiveMime)) throw new HostError(`file signature does not match ${effectiveMime}`);

  const fallback = file.file_name || file.name || `${file.file_id}.bin`;
  const filename = safeFilename(opts.filename, fallback);
  const result = await uploadInto(opts.dest, [{ relPath: filename, data }]);
  if (result.written !== 1 || result.failed.length) throw new HostError(`file import failed: ${result.failed.join(", ") || "not written"}`);

  return {
    ok: true,
    fileId: file.file_id,
    path: path.join(opts.dest, filename),
    filename,
    mimeType,
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

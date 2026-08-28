import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const FORBIDDEN_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan"];
const MAX_PROVIDER_URL_BYTES = 4 * 1024;

type LookupAnswer = { address: string; family: number };
type Resolver = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAnswer[]>;
export type PinnedEndpoint = { url: URL; address: string; family: 4 | 6 };

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  return nums.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? nums : null;
}

function ipv6Bytes(address: string): number[] | null {
  const zoneFree = address.toLowerCase().split("%")[0];
  let source = zoneFree;
  let ipv4Tail: number[] | null = null;
  const lastColon = source.lastIndexOf(":");
  if (source.includes(".") && lastColon >= 0) {
    ipv4Tail = parseIpv4(source.slice(lastColon + 1));
    if (!ipv4Tail) return null;
    source = `${source.slice(0, lastColon)}:${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group || "0")) return null;
    const value = Number.parseInt(group || "0", 16);
    bytes.push(value >>> 8, value & 0xff);
  }
  return bytes;
}

function isForbiddenIpv4(address: string): boolean {
  const p = parseIpv4(address);
  if (!p) return true;
  const [a, b, c] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isForbiddenIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const allZero = bytes.every((value) => value === 0);
  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  if (allZero || loopback) return true;
  // IPv4-compatible/mapped addresses must obey the IPv4 policy too.
  const mapped = bytes.slice(0, 10).every((value) => value === 0) &&
    ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0));
  if (mapped) return isForbiddenIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // docs
  if (bytes[0] === 0x01 && bytes.slice(1, 8).every((value) => value === 0)) return true; // discard-only 100::/64
  return false;
}

export function isForbiddenProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family === 6) return isForbiddenIpv6(address);
  return true;
}

/** Syntax/literal guard used when accepting configuration. Network calls must also
 * use resolveSafeProviderEndpoint/safeProviderFetch so DNS cannot rebind at connect. */
export function assertSafeUrl(raw: string): URL {
  if (Buffer.byteLength(raw, "utf8") > MAX_PROVIDER_URL_BYTES) throw new Error("Base URL is too long");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Base URL is not a valid URL");
  }
  const insecureAllowed = process.env.OS_CUSTOM_PROVIDER_ALLOW_INSECURE_HTTP === "1";
  if (url.protocol !== "https:" && !(insecureAllowed && url.protocol === "http:")) {
    throw new Error("Base URL must use HTTPS (set OS_CUSTOM_PROVIDER_ALLOW_INSECURE_HTTP=1 only for an explicitly accepted public HTTP endpoint)");
  }
  if (url.username || url.password) throw new Error("Base URL must not contain credentials");
  if (url.hash) throw new Error("Base URL must not contain a fragment");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host === "0.0.0.0" || FORBIDDEN_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error("Base URL host not allowed (private / loopback / link-local / metadata)");
  }
  if (isIP(host) && isForbiddenProviderAddress(host)) {
    throw new Error("Base URL host not allowed (private / loopback / link-local / metadata)");
  }
  return url;
}

export async function resolveSafeProviderEndpoint(
  raw: string | URL,
  resolver: Resolver = dnsLookup,
): Promise<PinnedEndpoint> {
  const url = assertSafeUrl(String(raw));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(host);
  const resolved: LookupAnswer[] = literalFamily
    ? [{ address: host, family: literalFamily as 4 | 6 }]
    : await resolver(host, { all: true, verbatim: true });
  if (!resolved.length) throw new Error("Base URL host did not resolve");
  if (resolved.some((entry) => isForbiddenProviderAddress(entry.address))) {
    throw new Error("Base URL DNS resolved to a private / loopback / link-local / metadata address");
  }
  const first = resolved[0];
  if (first.family !== 4 && first.family !== 6) throw new Error("Base URL resolved to an unsupported address family");
  return { url, address: first.address, family: first.family };
}

function responseHeaders(raw: NodeJS.Dict<string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/** Fetch-compatible transport for custom AI providers. It resolves on every request,
 * rejects any non-public answer, then pins the actual socket lookup to the reviewed IP.
 * Redirects are deliberately not followed, so an API key cannot cross to a new host. */
export async function safeProviderFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const pinned = await resolveSafeProviderEndpoint(request.url);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  return await new Promise<Response>((resolve, reject) => {
    const transport = pinned.url.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = transport({
      protocol: pinned.url.protocol,
      hostname: pinned.url.hostname,
      port: pinned.url.port || undefined,
      path: `${pinned.url.pathname}${pinned.url.search}`,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      const status = response.statusCode ?? 502;
      const stream = Readable.toWeb(response) as ReadableStream<Uint8Array>;
      resolve(new Response(stream, {
        status,
        statusText: response.statusMessage,
        headers: responseHeaders(response.headers),
      }));
    });
    const abort = () => upstream.destroy(new DOMException("The operation was aborted", "AbortError"));
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    upstream.once("error", reject);
    upstream.once("close", () => request.signal.removeEventListener("abort", abort));
    if (body?.length) upstream.write(body);
    upstream.end();
  });
}

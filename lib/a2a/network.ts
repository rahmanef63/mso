import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
  assertSafeUrl,
  resolveSafeProviderEndpoint,
  safeProviderFetch,
} from "@/lib/host/ssrf";

export const A2A_ALLOW_LOOPBACK_ENV = "OS_A2A_ALLOW_LOOPBACK";
const MAX_A2A_URL_BYTES = 4 * 1024;

type LookupAnswer = { address: string; family: number };
type Resolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAnswer[]>;

type A2AEndpoint = {
  url: URL;
  address: string;
  family: 4 | 6;
  loopback: boolean;
};

function cleanHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

export function a2aLoopbackEnabled(): boolean {
  return process.env[A2A_ALLOW_LOOPBACK_ENV] !== "0";
}

export function isExactA2ALoopbackHost(host: string): boolean {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, "");
  return clean === "127.0.0.1" || clean === "::1" || clean === "localhost";
}

export function isA2ALoopbackUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(String(value));
  } catch {
    return false;
  }
  return url.protocol === "http:" && isExactA2ALoopbackHost(cleanHost(url));
}

function basicUrl(raw: string | URL): URL {
  const text = String(raw);
  if (Buffer.byteLength(text, "utf8") > MAX_A2A_URL_BYTES)
    throw new Error("A2A URL is too long");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("A2A URL is not a valid URL");
  }
  if (url.username || url.password)
    throw new Error("A2A URL must not contain credentials");
  if (url.hash) throw new Error("A2A URL must not contain a fragment");
  return url;
}

export function assertA2AUrl(raw: string | URL): URL {
  const candidate = basicUrl(raw);
  if (isA2ALoopbackUrl(candidate)) {
    if (!a2aLoopbackEnabled())
      throw new Error(
        `A2A loopback HTTP is disabled; set ${A2A_ALLOW_LOOPBACK_ENV}=1 only for same-host agent communication`,
      );
    return candidate;
  }
  const publicUrl = assertSafeUrl(candidate.toString());
  if (publicUrl.protocol !== "https:")
    throw new Error("A2A public endpoints must use HTTPS");
  return publicUrl;
}

function exactLoopbackAddress(address: string): boolean {
  const clean = address.toLowerCase().split("%")[0];
  return clean === "127.0.0.1" || clean === "::1";
}

export async function resolveA2AEndpoint(
  raw: string | URL,
  resolver: Resolver = dnsLookup,
): Promise<A2AEndpoint> {
  const url = assertA2AUrl(raw);
  if (!isA2ALoopbackUrl(url)) {
    const pinned = await resolveSafeProviderEndpoint(url, resolver);
    return { ...pinned, loopback: false };
  }

  const host = cleanHost(url);
  const literalFamily = isIP(host);
  if (literalFamily) {
    if (!exactLoopbackAddress(host))
      throw new Error("A2A local endpoint must use exact loopback only");
    return {
      url,
      address: host,
      family: literalFamily as 4 | 6,
      loopback: true,
    };
  }

  // `localhost` is explicitly allowed, but never trust /etc/hosts or DNS to turn
  // it into a LAN/private destination. Every answer must still be exact loopback.
  const answers = await resolver(host, { all: true, verbatim: true });
  if (!answers.length) throw new Error("A2A localhost did not resolve");
  if (answers.some((entry) => !exactLoopbackAddress(entry.address))) {
    throw new Error("A2A localhost resolved outside exact loopback");
  }
  const first = answers[0];
  if (first.family !== 4 && first.family !== 6)
    throw new Error("A2A localhost resolved to an unsupported address family");
  return { url, address: first.address, family: first.family, loopback: true };
}

function responseHeaders(raw: NodeJS.Dict<string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

async function pinnedLoopbackFetch(
  endpoint: A2AEndpoint,
  request: Request,
): Promise<Response> {
  const body = request.body
    ? Buffer.from(await request.arrayBuffer())
    : undefined;
  return new Promise<Response>((resolve, reject) => {
    const transport =
      endpoint.url.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = transport(
      {
        protocol: endpoint.url.protocol,
        hostname: cleanHost(endpoint.url),
        port: endpoint.url.port || undefined,
        path: `${endpoint.url.pathname}${endpoint.url.search}`,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        lookup: (_hostname, _options, callback) =>
          callback(null, endpoint.address, endpoint.family),
      },
      (response) => {
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 502,
            statusText: response.statusMessage,
            headers: responseHeaders(response.headers),
          }),
        );
      },
    );
    const abort = () =>
      upstream.destroy(
        new DOMException("The operation was aborted", "AbortError"),
      );
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    upstream.once("error", reject);
    upstream.once("close", () =>
      request.signal.removeEventListener("abort", abort),
    );
    if (body?.length) upstream.write(body);
    upstream.end();
  });
}

export async function a2aNetworkFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const url = assertA2AUrl(request.url);
  if (!isA2ALoopbackUrl(url)) return safeProviderFetch(request);
  const endpoint = await resolveA2AEndpoint(url);
  return pinnedLoopbackFetch(endpoint, request);
}

export function a2aLoopbackOrigin(): string {
  const raw = process.env.OS_A2A_LOOPBACK_ORIGIN?.trim();
  const fallbackPort = String(
    process.env.PORT || process.env.MSO_PORT || "4005",
  );
  const url = assertA2AUrl(raw || `http://127.0.0.1:${fallbackPort}`);
  if (!isA2ALoopbackUrl(url))
    throw new Error("OS_A2A_LOOPBACK_ORIGIN must be exact HTTP loopback");
  return url.origin;
}

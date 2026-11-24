// File-system Web Fetch router for MSO (app/**/route.ts + proxy.ts + frontend/svelte/build).
// Replaces Next.js App Router runtime with zero framework overhead.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest, NextResponse } from "./next-server-shim";
import { runWithRequestHeaders } from "./next-headers-shim";
import { onRequestError } from "./server-bootstrap";
import { injectScriptNonces } from "./csp-nonce";
import { proxy } from "../../proxy";

export { injectScriptNonces };

type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response> | Response;

type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS", RouteHandler>>;

type CompiledRoute = {
  pattern: string;
  filePath: string;
  score: number;
  regex: RegExp;
  extract: (match: RegExpExecArray) => Record<string, string | string[] | undefined>;
  mod?: RouteModule;
};

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".pdf": "application/pdf", ".webm": "video/webm", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8",
};
const RESERVED_STATIC_PREFIXES = ["/api", "/_next", "/mcp", "/oauth", "/.well-known", "/a2a"];

function scanRouteFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanRouteFiles(full, out);
    else if (entry.isFile() && entry.name === "route.ts") out.push(full);
  }
  return out;
}

export function compileRoutePattern(appRoot: string, filePath: string): CompiledRoute {
  const rel = path.relative(appRoot, path.dirname(filePath)).replace(/\\/g, "/");
  const segments = rel ? rel.split("/") : [];
  let regexStr = "^";
  let score = 0;
  const extractors: Array<(m: RegExpExecArray, idx: number) => [string, string | string[] | undefined]> = [];

  for (const seg of segments) {
    if (seg.startsWith("[[...") && seg.endsWith("]]")) {
      const name = seg.slice(5, -2);
      regexStr += "(?:/(.*))?";
      score += 1;
      extractors.push((m, i) => [name, m[i] ? m[i].split("/").map(decodeURIComponent) : undefined]);
    } else if (seg.startsWith("[...") && seg.endsWith("]")) {
      const name = seg.slice(4, -1);
      regexStr += "/(.+)";
      score += 2;
      extractors.push((m, i) => [name, m[i] ? m[i].split("/").map(decodeURIComponent) : []]);
    } else if (seg.startsWith("[") && seg.endsWith("]")) {
      const name = seg.slice(1, -1);
      regexStr += "/([^/]+)";
      score += 10;
      extractors.push((m, i) => [name, decodeURIComponent(m[i] ?? "")]);
    } else {
      const escaped = seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regexStr += `/${escaped}`;
      score += 100;
    }
  }
  regexStr += "/?$";
  const regex = new RegExp(regexStr === "^/?$" ? "^/$" : regexStr);
  return {
    pattern: "/" + rel,
    filePath,
    score,
    regex,
    extract(match) {
      const params: Record<string, string | string[] | undefined> = {};
      extractors.forEach((fn, idx) => {
        const [k, v] = fn(match, idx + 1);
        params[k] = v;
      });
      return params;
    },
  };
}

let cachedRoutes: CompiledRoute[] | null = null;

export function getCompiledRoutes(rootDir = process.cwd()): CompiledRoute[] {
  if (cachedRoutes) return cachedRoutes;
  const appRoot = path.join(rootDir, "app");
  cachedRoutes = scanRouteFiles(appRoot)
    .map((f) => compileRoutePattern(appRoot, f))
    .sort((a, b) => b.score - a.score || b.pattern.length - a.pattern.length);
  return cachedRoutes;
}

function applyMiddlewareOverrides(reqHeaders: Headers, proxyRes: Response): Headers {
  const nextHeaders = new Headers(reqHeaders);
  const overrideList = proxyRes.headers.get("x-middleware-override-headers");
  if (!overrideList) return nextHeaders;
  const allowed = new Set(overrideList.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  for (const key of Array.from(nextHeaders.keys())) {
    if (!allowed.has(key.toLowerCase())) nextHeaders.delete(key);
  }
  for (const key of allowed) {
    const val = proxyRes.headers.get(`x-middleware-request-${key}`);
    if (val !== null) nextHeaders.set(key, val);
  }
  return nextHeaders;
}

function copyProxyResponseHeaders(target: Headers, proxyRes: Response): void {
  proxyRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-middleware-")) return;
    if (!target.has(key)) target.set(key, value);
  });
}

function tryServeStatic(rootDir: string, pathname: string, nonce: string | null): Response | null {
  const lowerPath = pathname.toLowerCase();
  if (RESERVED_STATIC_PREFIXES.some((p) => lowerPath === p || lowerPath.startsWith(`${p}/`))) {
    return null;
  }
  const safeRel = path.posix.normalize(pathname).replace(/^\/+/, "");
  if (safeRel.includes("..")) return null;
  const svelteBuild = path.join(rootDir, "frontend/svelte/build");
  const publicDir = path.join(rootDir, "public");
  const lastSegment = safeRel.split("/").pop() ?? "";
  const isExtensionedAsset = lastSegment.includes(".");
  const candidates = isExtensionedAsset
    ? [path.join(svelteBuild, safeRel), path.join(publicDir, safeRel)]
    : [
        path.join(svelteBuild, safeRel),
        path.join(publicDir, safeRel),
        path.join(svelteBuild, safeRel, "index.html"),
        path.join(svelteBuild, "index.html"),
      ];
  for (const candidate of candidates) {
    let body: Buffer;
    try {
      body = fs.readFileSync(candidate);
    } catch {
      continue;
    }
    const ext = path.extname(candidate).toLowerCase();
    const payload =
      ext === ".html" && nonce
        ? Buffer.from(injectScriptNonces(body.toString("utf8"), nonce), "utf8")
        : body;
    // Copy into a plain Uint8Array: the DOM BodyInit union rejects Buffer/ArrayBufferLike views.
    return new NextResponse(new Uint8Array(payload), {
      status: 200,
      headers: { "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream" },
    });
  }
  return null;
}

export async function dispatchMsoRequest(rawReq: Request, rootDir = process.cwd()): Promise<Response> {
  let req = rawReq instanceof NextRequest ? rawReq : new NextRequest(rawReq.url, rawReq);
  const proxyRes = await proxy(req);
  const rewrite = proxyRes.headers.get("x-middleware-rewrite");
  const isNext = proxyRes.headers.get("x-middleware-next") === "1";

  if (!rewrite && !isNext) return proxyRes;

  const overriddenHeaders = applyMiddlewareOverrides(req.headers, proxyRes);
  if (rewrite) {
    const destUrl = new URL(rewrite, req.nextUrl);
    if (destUrl.origin !== req.nextUrl.origin) {
      const upstream = await fetch(destUrl, {
        method: req.method,
        headers: overriddenHeaders,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        // @ts-expect-error Node fetch duplex stream support
        duplex: "half",
        redirect: "manual",
      });
      const resHeaders = new Headers(upstream.headers);
      copyProxyResponseHeaders(resHeaders, proxyRes);
      return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders });
    }
    req = new NextRequest(destUrl, {
      method: req.method,
      headers: overriddenHeaders,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // @ts-expect-error Node fetch duplex stream support
      duplex: "half",
    });
  } else {
    req = new NextRequest(req.url, {
      method: req.method,
      headers: overriddenHeaders,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // @ts-expect-error Node fetch duplex stream support
      duplex: "half",
    });
  }

  const pathname = req.nextUrl.pathname;
  for (const route of getCompiledRoutes(rootDir)) {
    const match = route.regex.exec(pathname);
    if (!match) continue;
    route.mod ??= (await import(pathToFileURL(route.filePath).href)) as RouteModule;
    const method = (req.method.toUpperCase() as keyof RouteModule);
    const handler = route.mod[method] ?? (method === "HEAD" ? route.mod.GET : undefined);
    if (!handler) return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
    try {
      const params = Promise.resolve(route.extract(match));
      const res = await runWithRequestHeaders(req.headers, () => handler(req, { params }));
      copyProxyResponseHeaders(res.headers, proxyRes);
      return res;
    } catch (err) {
      await onRequestError(err, { path: pathname, method: req.method });
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  }

  const staticRes = tryServeStatic(rootDir, pathname, overriddenHeaders.get("x-nonce"));
  if (staticRes) {
    copyProxyResponseHeaders(staticRes.headers, proxyRes);
    return staticRes;
  }
  return new NextResponse("Not Found", { status: 404 });
}

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { attachSocketProxy } from "./server-sockets.mjs";
import { requestBodyLimit } from "./server-body-policy.mjs";

if (!process.env.NEXT_PUBLIC_COMMIT_SHA || !process.env.NEXT_PUBLIC_BUILD_ID) {
  try {
    const metaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../frontend/svelte/build/build-meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (!process.env.NEXT_PUBLIC_COMMIT_SHA && typeof meta.buildSha === "string" && meta.buildSha) {
      process.env.NEXT_PUBLIC_COMMIT_SHA = meta.buildSha;
    }
    if (!process.env.NEXT_PUBLIC_BUILD_ID && typeof meta.buildId === "string" && meta.buildId) {
      process.env.NEXT_PUBLIC_BUILD_ID = meta.buildId;
    }
  } catch { /* fallback to env/dev when build-meta.json is absent */ }
}

if (!process.versions.bun) {
  register("./lib/ts-alias-loader.mjs", import.meta.url);
}

const { registerServerBootstrap } = await import("../lib/http/server-bootstrap.ts");
const { dispatchMsoRequest } = await import("../lib/http/router.ts");

const args = process.argv.slice(2);
const argument = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const hostname = argument("--hostname", process.env.HOSTNAME ?? "0.0.0.0");
const port = Number(argument("--port", process.env.PORT ?? "3000"));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid runtime port");
process.env.MSO_SOCKET_POLICY_SECRET = randomBytes(32).toString("hex");

await registerServerBootstrap();

const canonicalHost = /^(?:127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}|\[::1\]|::1|localhost)$/.test(hostname)
  ? "localhost"
  : hostname;

let activeBodies = 0;

const server = createServer(async (incoming, outgoing) => {
  const limit = requestBodyLimit(incoming.url);
  const hasBody = Number(incoming.headers["content-length"] ?? 0) > 0 || Boolean(incoming.headers["transfer-encoding"]);
  const reject = (status) => {
    outgoing.once("finish", () => incoming.destroy());
    outgoing.writeHead(status, { connection: "close" });
    outgoing.end();
  };
  if (Number(incoming.headers["content-length"] ?? 0) > limit) return reject(413);
  if (hasBody && activeBodies >= 32) return reject(429);
  if (hasBody) {
    activeBodies++;
    outgoing.once("close", () => { activeBodies--; });
  }

  let size = 0;
  incoming.on("data", (chunk) => {
    size += chunk.length;
    if (size <= limit) return;
    if (!outgoing.headersSent) reject(413);
    else outgoing.destroy();
  });

  try {
    const proto = String(incoming.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim() || "http";
    const url = `${proto}://${canonicalHost}:${port}${incoming.url ?? "/"}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(incoming.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else if (typeof v === "string") {
        headers.set(k, v);
      }
    }
    const method = incoming.method ?? "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming);
    const req = new Request(url, { method, headers, body, duplex: body ? "half" : undefined });
    const res = await dispatchMsoRequest(req);

    const outHeaders = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") return;
      outHeaders[k] = v;
    });
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (setCookies.length > 0) outHeaders["set-cookie"] = setCookies;

    outgoing.writeHead(res.status, outHeaders);
    if (!res.body || method === "HEAD") {
      outgoing.end();
      return;
    }
    for await (const chunk of res.body) {
      if (outgoing.destroyed) break;
      outgoing.write(chunk);
    }
    outgoing.end();
  } catch (error) {
    console.error("[mso-server] unhandled request error:", error instanceof Error ? error.message : "unknown_error");
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  }
});

const internalOrigin = `http://127.0.0.1:${port}`;
const closeSockets = attachSocketProxy(server, async (request) => {
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([, value]) => typeof value === "string"));
  const host = headers.host;
  if (!host || !request.url?.startsWith("/")) return null;
  const response = await fetch(`${internalOrigin}/api/internal/socket-policy`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(3000),
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MSO_SOCKET_POLICY_SECRET}` },
    body: JSON.stringify({ url: `http://${host}${request.url}`, headers }),
  });
  return response.ok ? response.json() : null;
});

server.listen(port, hostname);
const shutdown = () => {
  closeSockets();
  server.closeAllConnections();
  server.close(() => process.exit(0));
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

import next from "next";
import { createServer, request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";
import { attachSocketProxy } from "./server-sockets.mjs";
import { requestBodyLimit } from "./server-body-policy.mjs";

const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const hostname = argument("--hostname", process.env.HOSTNAME ?? "0.0.0.0");
const port = Number(argument("--port", process.env.PORT ?? "3000"));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid runtime port");
process.env.MSO_SOCKET_POLICY_SECRET = randomBytes(32).toString("hex");
const internal = createServer();
const app = next({ dev: false, hostname, port, httpServer: internal });
await app.prepare();
internal.on("request", app.getRequestHandler());
await new Promise((resolve) => internal.listen(0, "127.0.0.1", resolve));
const internalOrigin = `http://127.0.0.1:${internal.address().port}`;
let activeBodies = 0;
// Next owns HTTP on a private socket; only our public server receives upgrades.
const server = createServer((incoming, outgoing) => {
  const limit = requestBodyLimit(incoming.url);
  const hasBody = Number(incoming.headers["content-length"] ?? 0) > 0 || incoming.headers["transfer-encoding"];
  const reject = (status) => { outgoing.once("finish", () => incoming.destroy()); outgoing.writeHead(status, { connection: "close" }); outgoing.end(); };
  if (Number(incoming.headers["content-length"] ?? 0) > limit) return reject(413);
  if (hasBody && activeBodies >= 32) return reject(429);
  if (hasBody) { activeBodies++; outgoing.once("close", () => { activeBodies--; }); }
  const hop = httpRequest({ hostname: "127.0.0.1", port: internal.address().port, path: incoming.url, method: incoming.method, headers: incoming.headers }, (response) => {
    outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
  });
  hop.once("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
  incoming.once("aborted", () => hop.destroy());
  outgoing.once("close", () => hop.destroy());
  let size = 0;
  incoming.on("data", chunk => {
    size += chunk.length;
    if (size <= limit) return;
    incoming.unpipe(hop); hop.destroy();
    if (!outgoing.headersSent) reject(413); else outgoing.destroy();
  });
  incoming.pipe(hop);
});
const closeSockets = attachSocketProxy(server, async (request) => {
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([, value]) => typeof value === "string"));
  const host = headers.host;
  if (!host || !request.url?.startsWith("/")) return null;
  const response = await fetch(`${internalOrigin}/api/internal/socket-policy`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(3000),
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MSO_SOCKET_POLICY_SECRET}` },
    body: JSON.stringify({ url: `http://${host}${request.url}`, headers }),
  });
  return response.ok ? response.json() : null;
});
server.listen(port, hostname);
const shutdown = () => { closeSockets(); server.closeAllConnections(); internal.closeAllConnections(); internal.close(); server.close(() => process.exit(0)); };
process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);

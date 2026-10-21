export const SERVER_SOURCE = `// Fake Orca upstream listener child. Explicitly NOT real Orca acceptance.
const http = require("node:http");
const server = http.createServer((req, res) => {
  if (process.send) process.send({ type: "hit", hit: { url: req.url || "", host: req.headers.host || "" } });
  if ((req.url || "").split("?")[0] === "/web-index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Orca fixture</title>orca-fixture-upstream\\n");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("upstream: no such path\\n");
});
server.listen(0, "127.0.0.1", () => {
  const a = server.address();
  if (process.send) process.send({ type: "listening", port: typeof a === "object" && a ? a.port : 0 });
});
function shutdown() {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("message", (m) => { if (m === "close" || m?.type === "close") shutdown(); });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
setInterval(() => {}, 1 << 30);
`;

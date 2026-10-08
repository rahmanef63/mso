import http from "node:http";

/** Keep authority attached to both socket directions for their entire lifetime. */
export function attachSocketProxy(server, authorize) {
  const connections = new Set();
  let active = 0;
  server.on("upgrade", async (request, client, head) => {
    // ponytail: 32 active sockets per process; shard only if real demand exceeds this.
    if (active >= 32 || (request.url?.length ?? 0) > 8192) { client.destroy(); return; }
    active += 1;
    client.pause();
    let upstream, poll, ended = false;
    const close = () => {
      if (ended) return;
      ended = true; active -= 1;
      connections.delete(close);
      clearInterval(poll); client.destroy(); upstream?.destroy();
    };
    connections.add(close);
    client.once("error", close); client.once("close", close);
    try {
      const policy = await authorize(request);
      if (!policy || ended) { close(); return; }
      const target = new URL(policy.target);
      if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.username || target.password) { close(); return; }
      const valid = async () => {
        const fresh = await authorize(request).catch(() => null);
        const ok = !ended && fresh?.identity === policy.identity && fresh?.target === policy.target;
        if (!ok) close();
        return ok;
      };
      const pending = http.request(target, { headers: policy.headers, timeout: 5000 });
      client.once("close", () => pending.destroy());
      pending.once("error", close); pending.once("timeout", () => { pending.destroy(); close(); });
      pending.once("response", (response) => { response.destroy(); close(); });
      pending.once("upgrade", async (response, socket, upstreamHead) => {
        upstream = socket;
        socket.pause(); socket.once("error", close); socket.once("close", close);
        if (!await valid()) return;
        const headers = ["upgrade", "connection", "sec-websocket-accept", "sec-websocket-protocol", "sec-websocket-extensions"];
        const handshake = headers.flatMap((name) => typeof response.headers[name] === "string" ? [`${name}: ${response.headers[name]}`] : []);
        client.write(`HTTP/1.1 101 Switching Protocols\r\n${handshake.join("\r\n")}\r\n\r\n`);
        if (upstreamHead.length) client.write(upstreamHead);
        if (head.length) socket.write(head);
        const forward = (source, destination) => {
          source.on("data", (chunk) => {
            source.pause();
            void valid().then((ok) => {
              if (ok) destination.write(chunk, () => { if (!ended) source.resume(); });
            }).catch(close);
          });
          source.once("end", close);
          source.resume();
        };
        forward(client, socket); forward(socket, client);
        // Idle connections are checked too; traffic is checked before every delivery.
        let checking = false;
        poll = setInterval(() => {
          if (checking) return;
          checking = true;
          void valid().finally(() => { checking = false; });
        }, 1000);
        poll.unref();
      });
      pending.end();
    } catch { close(); }
  });
  return () => { for (const close of connections) close(); };
}

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { referencedStaticAssets, verifyServedStaticAssets, waitForServedRoot } from "./lib/served-assets.mjs";

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

async function serve(bad = false, rootFailures = 0) {
  server = createServer((req, res) => {
    if (req.url === "/") {
      if (rootFailures-- > 0) { res.statusCode = 503; res.end("starting"); return; }
      res.setHeader("content-type", "text/html");
      res.end('<script src="/_next/static/chunks/a.js"></script><link rel="stylesheet" href="/_next/static/css/b.css"><script src="/_next/static/chunks/a.js"></script>');
      return;
    }
    if (req.url === "/_next/static/chunks/a.js") {
      res.statusCode = bad ? 500 : 200; res.setHeader("content-type", bad ? "text/plain" : "application/javascript"); res.end(); return;
    }
    if (req.url === "/_next/static/css/b.css") { res.setHeader("content-type", "text/css; charset=utf-8"); res.end(); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing test port");
  return `http://127.0.0.1:${address.port}`;
}

describe("served Next asset graph", () => {
  it("deduplicates and extracts all referenced JS/CSS assets", () => {
    expect(referencedStaticAssets('<script src="/_next/static/chunks/a.js"></script><script src="/_next/static/chunks/a.js"></script><link href="/_next/static/css/b.css">'))
      .toEqual(["/_next/static/chunks/a.js", "/_next/static/css/b.css"]);
  });
  it("passes only when every referenced asset is healthy with the right MIME", async () => {
    const base = await serve(false); await expect(verifyServedStaticAssets(base)).resolves.toMatchObject({ assetCount: 2 });
  });
  it("fails on the exact 500 text/plain chunk class that breaks the shell", async () => {
    const base = await serve(true); await expect(verifyServedStaticAssets(base)).rejects.toThrow(/a\.js: 500 text\/plain/);
  });
  it("waits through cold-start HTTP failures before checking the complete graph", async () => {
    const base = await serve(false, 2);
    await waitForServedRoot(base, 1_000, 5);
    await expect(verifyServedStaticAssets(base)).resolves.toMatchObject({ assetCount: 2 });
  });
  it("does not turn a broken asset into success after HTTP becomes ready", async () => {
    const base = await serve(true, 1);
    await waitForServedRoot(base, 1_000, 5);
    await expect(verifyServedStaticAssets(base)).rejects.toThrow(/asset graph mismatch/);
  });
  it("refuses endless readiness waits and times out a persistently unavailable root", async () => {
    const base = await serve(false, 1000);
    await expect(waitForServedRoot(base, 40, 5)).rejects.toThrow(/did not become ready/);
    await expect(waitForServedRoot(base, 0)).rejects.toThrow(/bounded timeout/);
    await expect(waitForServedRoot(base, 60001)).rejects.toThrow(/bounded timeout/);
  });

});

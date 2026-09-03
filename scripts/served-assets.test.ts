import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { referencedStaticAssets, verifyServedStaticAssets } from "./lib/served-assets.mjs";

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

async function serve(bad = false) {
  server = createServer((req, res) => {
    if (req.url === "/") {
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
});

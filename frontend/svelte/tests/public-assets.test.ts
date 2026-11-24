import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { msoPublicAssetsPlugin, syncPublicAssets, trySendFile } from "../tooling/public-assets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ASSETS_SOURCE = path.resolve(HERE, "../tooling/public-assets.mjs");

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | string | undefined;
  ended: boolean;
  setHeader(name: string, value: string): void;
  end(chunk?: Buffer | string): void;
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    end(chunk?: Buffer | string) {
      res.body = chunk;
      res.ended = true;
    },
  };
  return res;
}

describe("public-assets tooling", () => {
  it("avoids check-then-use fs race patterns", () => {
    const src = readFileSync(PUBLIC_ASSETS_SOURCE, "utf8");
    assert.doesNotMatch(src, /\b(existsSync|statSync|lstatSync|accessSync)\b/);
  });

  it("syncs public asset directories and root icons into build-meta.json", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "mso-public-assets-"));
    try {
      const publicDir = path.join(tmp, "public");
      const buildDir = path.join(tmp, "build");
      mkdirSync(path.join(publicDir, "wallpapers", "nested"), { recursive: true });
      writeFileSync(path.join(publicDir, "wallpapers", "macos.webp"), "webp-bytes");
      writeFileSync(path.join(publicDir, "wallpapers", "nested", "extra.png"), "png-bytes");
      writeFileSync(path.join(publicDir, "icon.svg"), "<svg/>");

      const meta = syncPublicAssets(publicDir, buildDir, { sha: "abc123456789", mode: "production" });
      assert.equal(meta.sha, "abc123456789");
      assert.equal(meta.mode, "production");
      assert.deepEqual(meta.assets, [
        "/icon.svg",
        "/wallpapers/macos.webp",
        "/wallpapers/nested/extra.png",
      ]);

      const persisted = JSON.parse(readFileSync(path.join(buildDir, "build-meta.json"), "utf8"));
      assert.deepEqual(persisted.assets, meta.assets);
      assert.equal(readFileSync(path.join(buildDir, "icon.svg"), "utf8"), "<svg/>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reads files directly in trySendFile and rejects directories or missing paths", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "mso-try-send-"));
    try {
      const filePath = path.join(tmp, "sample.svg");
      writeFileSync(filePath, "<svg>ok</svg>");

      const getRes = createMockRes();
      assert.equal(trySendFile(filePath, getRes, "GET"), true);
      assert.equal(getRes.statusCode, 200);
      assert.equal(getRes.headers["content-type"], "image/svg+xml");
      assert.equal(getRes.headers["content-length"], String(Buffer.byteLength("<svg>ok</svg>")));
      assert.equal(Buffer.isBuffer(getRes.body) ? getRes.body.toString("utf8") : getRes.body, "<svg>ok</svg>");

      const headRes = createMockRes();
      assert.equal(trySendFile(filePath, headRes, "HEAD"), true);
      assert.equal(headRes.statusCode, 200);
      assert.equal(headRes.body, undefined);

      const dirRes = createMockRes();
      assert.equal(trySendFile(tmp, dirRes, "GET"), false);
      assert.equal(dirRes.ended, false);

      const missingRes = createMockRes();
      assert.equal(trySendFile(path.join(tmp, "missing.webp"), missingRes, "GET"), false);
      assert.equal(missingRes.ended, false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("serves built assets, 404s missing extensioned files, and falls back deep links to index.html", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "mso-preview-mw-"));
    try {
      const publicDir = path.join(tmp, "public");
      const buildDir = path.join(tmp, "build");
      mkdirSync(path.join(buildDir, "wallpapers"), { recursive: true });
      writeFileSync(path.join(buildDir, "index.html"), "<!doctype html><html><body>MSO</body></html>");
      writeFileSync(path.join(buildDir, "wallpapers", "win.webp"), "win-bytes");

      type Handler = (req: { method: string; url: string }, res: MockRes, next: () => void) => void;
      let middleware: Handler | null = null;
      const plugin = msoPublicAssetsPlugin({ publicDir, buildDir });
      plugin.configurePreviewServer({
        middlewares: {
          use(fn: Handler) {
            middleware = fn;
          },
        },
      });
      assert.ok(middleware);
      const handle: Handler = middleware;

      const assetRes = createMockRes();
      handle({ method: "GET", url: "/wallpapers/win.webp" }, assetRes, () => {
        throw new Error("should not call next for built asset");
      });
      assert.equal(assetRes.statusCode, 200);
      assert.equal(assetRes.headers["content-type"], "image/webp");

      const missingAssetRes = createMockRes();
      handle({ method: "GET", url: "/wallpapers/nope.webp" }, missingAssetRes, () => {
        throw new Error("should not call next for missing extensioned asset");
      });
      assert.equal(missingAssetRes.statusCode, 404);

      const deepLinkRes = createMockRes();
      handle({ method: "GET", url: "/files/home/demo" }, deepLinkRes, () => {
        throw new Error("should not call next for deep link");
      });
      assert.equal(deepLinkRes.statusCode, 200);
      assert.equal(deepLinkRes.headers["content-type"], "text/html; charset=utf-8");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

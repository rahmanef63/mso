import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Wallpaper URLs carry a content hash: `url("/wallpapers/aurora.webp?v=ad083c6c2ccb")`, and
// next.config.mjs serves /wallpapers/* as `immutable` for a year. That combination means a wrong
// hash is not a cosmetic mistake — clients that already cached the old URL never re-fetch, so a
// re-encoded image stays invisible to them for twelve months.
//
// app/wallpaper-cache.test.ts checks the two default wallpapers. This one checks EVERY hashed
// asset URL in the stylesheet, so a future re-encode of any of them is caught the same way.
// It exists because the hash did go stale: commit a7933d94 re-encoded five wallpapers and left
// globals.css pointing at the previous bytes, and nothing failed.

const CSS = path.resolve(__dirname, "globals.css");

describe("hashed asset URLs in globals.css", () => {
  const css = readFileSync(CSS, "utf8");
  const hashed = [...css.matchAll(/url\("(\/[^"?]+)\?v=([0-9a-f]{8,64})"\)/g)].map((m) => ({ url: m[1], hash: m[2] }));

  it("finds the hashed URLs it is meant to guard", () => {
    // If someone removes the ?v= scheme, this suite must fail loudly rather than silently
    // checking nothing.
    expect(hashed.length, "expected at least one ?v= asset URL in globals.css").toBeGreaterThan(0);
  });

  it.each(hashed.map((h) => [h.url, h.hash] as const))("%s?v matches the file on disk", (url, hash) => {
    const file = path.resolve(__dirname, "..", "public", url.replace(/^\//, ""));
    expect(existsSync(file), `${url} is referenced from globals.css but does not exist`).toBe(true);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(
      digest.startsWith(hash),
      `${url} carries ?v=${hash} but its sha256 is ${digest.slice(0, 12)}. Re-encoding the asset ` +
        `requires updating the hash, or clients with the old URL cached will never fetch the new bytes.`,
    ).toBe(true);
  });
});

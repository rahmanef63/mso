import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");

describe("immutable default wallpaper cache keys", () => {
  it.each(["aurora.webp", "aurora-dark.webp"])("%s URL changes with its image bytes", name => {
    const digest = createHash("sha256").update(readFileSync(`public/wallpapers/${name}`)).digest("hex").slice(0, 12);
    expect(css).toContain(`url("/wallpapers/${name}?v=${digest}")`);
    expect(css).not.toContain(`url("/wallpapers/${name}")`);
  });
});

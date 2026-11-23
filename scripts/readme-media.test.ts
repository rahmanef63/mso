import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const capture = readFileSync(path.join(root, "scripts/capture-cli.mjs"), "utf8");

describe("README demonstration contract", () => {
  it("embeds the main product demos and documents Rust + Svelte 5 and minimum specs", () => {
    expect(readme).toMatch(/!\[[^\]]*\]\(\.\/docs\/media\/demo\.gif\)/);
    expect(readme).toMatch(/!\[[^\]]*\]\(\.\/docs\/media\/mso-cli\.webp\)/);
    expect(readme).not.toContain("svelte-rust-perf.gif");
    expect(readme).not.toContain("hybrid-svelte-rust-bench.webp");
    expect(readme).toContain("Now in Rust + Svelte 5");
    expect(readme).toContain("Minimum machine specs");
    expect(readme).toContain("https://manef.dev/mso/demo");
    expect(readme).toContain("https://mso.manef.dev/");
  });

  it("ships a real multi-frame GIF and a decodable CLI capture", async () => {
    const gif = await sharp(path.join(root, "docs/media/demo.gif"), { animated: true }).metadata();
    expect(gif.format).toBe("gif");
    expect(gif.pages).toBeGreaterThan(1);
    const cli = await sharp(path.join(root, "docs/media/mso-cli.webp")).metadata();
    expect(cli.format).toBe("webp");
    expect(cli.width).toBeGreaterThan(600);
    expect(cli.height).toBeGreaterThan(600);
  });

  it("captures the interactive mso Agent rather than a help screen", () => {
    expect(capture).toContain("scripts/mso-agent.mjs");
    expect(capture).toContain("INTERACTIVE MSO AGENT");
    expect(capture).toContain("$ mso");
    expect(capture).not.toContain('reset", "--help');
    expect(capture).not.toContain("$ mso reset --help");
    expect(readme).toContain("Interactive `mso` Agent terminal");
  });

  it("keeps the landing README bounded and links rather than hides safety evidence", () => {
    expect(readme.split("\n").length).toBeLessThanOrEqual(120);
    expect(readme).toContain("./docs/SECURITY-ASSURANCE.md");
    expect(readme).toContain("./docs/MAINTENANCE.md");
    expect(readme).toContain("Public Alpha");
  });
});

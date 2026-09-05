import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readme = readFileSync(path.join(root, "README.md"), "utf8");
describe("README demonstration contract", () => {
  it("embeds the animation, not only a text link to it", () => {
    expect(readme).toMatch(/!\[[^\]]*\]\(\.\/docs\/media\/demo\.gif\)/);
    expect(readme).toMatch(/!\[[^\]]*\]\(\.\/docs\/media\/mso-cli\.webp\)/);
  });
  it("ships a real multi-frame GIF and a decodable CLI capture", async () => {
    const gif = await sharp(path.join(root, "docs/media/demo.gif"), { animated: true }).metadata();
    expect(gif.format).toBe("gif"); expect(gif.pages).toBeGreaterThan(1);
    const cli = await sharp(path.join(root, "docs/media/mso-cli.webp")).metadata();
    expect(cli.format).toBe("webp"); expect(cli.width).toBeGreaterThan(600);
  });
  it("keeps the landing README bounded and links rather than hides safety evidence", () => {
    expect(readme.split("\n").length).toBeLessThanOrEqual(150);
    expect(readme).toContain("./docs/SECURITY-ASSURANCE.md");
    expect(readme).toContain("./docs/MAINTENANCE.md");
    expect(readme).toContain("Public Alpha");
  });
});

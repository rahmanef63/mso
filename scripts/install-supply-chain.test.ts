import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("installer bootstrap supply chain", () => {
  const source = fs.readFileSync("scripts/install-core.sh", "utf8");

  it("pins NodeSource setup to an immutable repository commit and SHA-256", () => {
    expect(source).toMatch(/NODESOURCE_SETUP_COMMIT="[0-9a-f]{40}"/);
    expect(source).toMatch(/NODESOURCE_SETUP_SHA256="[0-9a-f]{64}"/);
    expect(source).toContain("raw.githubusercontent.com/nodesource/distributions/$NODESOURCE_SETUP_COMMIT/scripts/deb/setup_22.x");
    expect(source).toContain('sha256sum "$setup"');
    expect(source).not.toMatch(/deb\.nodesource\.com\/setup_22\.x\s*\|\s*(?:sudo_do\s+-E\s+)?bash/);
  });
});

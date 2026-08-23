import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Quicklinks responsive layout", () => {
  it("uses pane/container breakpoints rather than viewport breakpoints", () => {
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    const settings = readFileSync(new URL("../os-settings/components/quicklinks-section.tsx", import.meta.url), "utf8");
    expect(app).toContain("@sm:grid-cols-4");
    expect(app).toContain("@md:grid-cols-5");
    expect(settings).toContain("flex-wrap");
    expect(settings).toContain("basis-full");
    expect(settings).toContain("@md:flex-row");
  });
});

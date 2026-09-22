import { describe, expect, it } from "vitest";
import { BUILTIN_APPS } from "./shell.manifest";

describe("Channels mobile-home registration", () => {
  it("keeps Channels, Docs and Settings on the first 24-icon page", () => {
    const index = (slug: string) => BUILTIN_APPS.findIndex((app) => app.slug === slug);
    expect(index("channels")).toBeGreaterThanOrEqual(0);
    expect(index("channels")).toBeLessThan(24);
    expect(index("docs")).toBeGreaterThanOrEqual(0);
    expect(index("docs")).toBeLessThan(24);
    expect(index("settings")).toBeGreaterThanOrEqual(0);
    expect(index("settings")).toBeLessThan(24);
    expect(index("links")).toBeGreaterThanOrEqual(24);
  });
});

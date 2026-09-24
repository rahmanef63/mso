import { describe, expect, it } from "vitest";
import { BUILTIN_APPS } from "./shell.manifest";

describe("Memory graph registration", () => {
  it("keeps Memory addressable without pushing Docs or Settings off the first home page", () => {
    const app = BUILTIN_APPS.find((item) => item.id === "memory-graph");
    expect(app?.slug).toBe("memory");
    expect(app?.title).toBe("Memory");
    const index = (slug: string) => BUILTIN_APPS.findIndex((item) => item.slug === slug);
    expect(index("docs")).toBeLessThan(24);
    expect(index("settings")).toBeLessThan(24);
    expect(index("memory")).toBeGreaterThan(index("links"));
  });
});

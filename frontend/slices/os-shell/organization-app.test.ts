import { describe, expect, it } from "vitest";
import { BUILTIN_APPS } from "./shell.manifest";

describe("Organization app registration", () => {
  it("exposes Organization as a first-class built-in route", () => {
    const app = BUILTIN_APPS.find((item) => item.id === "organization");
    expect(app).toBeDefined();
    expect(app?.title).toBe("Organization");
    expect(app?.slug).toBe("organization");
    expect(app?.noDock).not.toBe(true);
  });
});

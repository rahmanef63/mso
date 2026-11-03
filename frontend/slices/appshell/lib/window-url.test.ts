import { describe, expect, it } from "vitest";
import type { AppDescriptor } from "./types";
import { stateToUrl } from "./window-url";

const app = { id: "external-tool", slug: "tool" } as AppDescriptor;
describe("restored window URL ownership", () => {
  it("defers a route rewrite until the connected app registry arrives", () => {
    expect(stateToUrl([], app.id, undefined)).toBeNull();
    expect(stateToUrl([app], app.id, undefined)).toBe("/tool");
  });
  it("keeps unavailable app routes for the explicit unavailable state", () => {
    expect(stateToUrl([app], "not-authorized", null)).toBeNull();
    expect(stateToUrl([app], null, null)).toBe("/");
  });
  it("preserves file paths and falls back to an app ID without a slug", () => {
    expect(stateToUrl([app], app.id, { path: "///home/file.txt" })).toBe("/tool/home/file.txt");
    expect(stateToUrl([{ ...app, slug: undefined }], app.id, { path: 1 })).toBe("/external-tool");
  });
});

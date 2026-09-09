import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("login return path", () => {
  it.each(["https://evil.test", "//evil.test", "/\\\\evil.test", "/\n/evil.test", "/login?returnTo=/login", null])("rejects unsafe destination %j", value => {
    expect(safeReturnPath(value)).toBe("/");
  });
  it("preserves a local destination and query", () => {
    expect(safeReturnPath("/integrations?transfer=1")).toBe("/integrations?transfer=1");
  });
});

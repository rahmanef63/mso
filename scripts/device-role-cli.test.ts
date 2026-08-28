import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeApproved, parseApprovalArgs, roleOf } = require("./lib/device-role-cli") as {
  normalizeApproved: (raw: unknown) => Record<string, { role: string }>;
  parseApprovalArgs: (args: string[]) => { id: string; label: string; role: string };
  roleOf: (entry: unknown) => string;
};

describe("local device role CLI helpers", () => {
  it("keeps legacy role-less approvals as owner but fails malformed roles down to viewer", () => {
    expect(roleOf({ label: "legacy" })).toBe("owner");
    expect(roleOf({ role: "operator" })).toBe("operator");
    expect(roleOf({ role: "admin" })).toBe("viewer");
    expect(normalizeApproved({ a: { label: "legacy" }, b: { role: "root" } })).toEqual({
      a: { label: "legacy", role: "owner" },
      b: { role: "viewer" },
    });
  });

  it("parses a quoted label independently from the explicit role option", () => {
    expect(parseApprovalArgs(["abc", "my phone", "--role", "viewer"])).toEqual({
      id: "abc", label: "my phone", role: "viewer",
    });
    expect(parseApprovalArgs(["abc", "recovery owner"])).toEqual({
      id: "abc", label: "recovery owner", role: "owner",
    });
  });
});

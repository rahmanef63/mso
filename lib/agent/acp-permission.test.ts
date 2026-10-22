import { describe, expect, it } from "vitest";
import { parsePermissionRequest, permissionOutcome } from "./acp-permission";

// Pure policy checks: no child process, no transport. The DENY-by-default and
// no-`allow_always` rules are the security contract, so they are pinned here.
describe("ACP permission policy", () => {
  const menu = [{ optionId: "always", kind: "allow_always", name: "Always" },
    { optionId: "once", kind: "allow_once", name: "Once" },
    { optionId: "no", kind: "reject_once", name: "No" },
    { optionId: "never", kind: "reject_always", name: "Never" }];

  it("picks allow_once for allow and reject_once for deny, never allow_always", () => {
    expect(permissionOutcome(menu, true)).toEqual({ outcome: "selected", optionId: "once" });
    expect(permissionOutcome(menu, false)).toEqual({ outcome: "selected", optionId: "no" });
    expect(permissionOutcome([{ optionId: "always", kind: "allow_always", name: "Always" }], true)).toBeNull();
  });

  it("returns null when an allow-only menu cannot express a denial", () => {
    expect(permissionOutcome([{ optionId: "always", kind: "allow_always", name: "A" }], false)).toBeNull();
    expect(permissionOutcome([], true)).toBeNull();
  });

  it("falls back to any reject-prefixed option", () => {
    expect(permissionOutcome([{ optionId: "x", kind: "reject_custom", name: "X" }], false))
      .toEqual({ outcome: "selected", optionId: "x" });
  });

  it("parses a well-formed request and rejects malformed input", () => {
    expect(parsePermissionRequest({ sessionId: "s", options: [{ optionId: "o", kind: "allow_once" }] }))
      .toEqual({ sessionId: "s", toolCall: {}, options: [{ optionId: "o", kind: "allow_once", name: "o" }] });
    expect(parsePermissionRequest(null)).toBeNull();
    expect(parsePermissionRequest([])).toBeNull();
    expect(parsePermissionRequest({ sessionId: "s" })).toBeNull();
    expect(parsePermissionRequest({ sessionId: "s", options: [{ kind: "allow_once" }] })).toBeNull();
  });
});

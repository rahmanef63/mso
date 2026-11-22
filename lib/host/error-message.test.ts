import { describe, expect, it } from "vitest";
import { clientMessage, errorMessage } from "./error-message";

// These two helpers exist because `String(error)` is a taint source for
// js/stack-trace-exposure, not a sanitiser. The behaviour being pinned is the split: an Error
// contributes its message, a literal code passes through, and nothing else is stringified.
// Verified against the real query: a version that forwarded arbitrary strings re-opened both
// alerts, so `clientMessage` is not a convenience wrapper — it is the boundary.

describe("errorMessage", () => {
  it("returns the message of a real Error", () => {
    expect(errorMessage(new Error("store read failed"))).toBe("store read failed");
  });

  it("never stringifies a thrown non-Error", () => {
    // A thrown object whose toString would leak internals. Stringify it and a stack can ride along.
    const sneaky = { toString: () => "Error: boom\n    at secret (/srv/app/lib/x.ts:1:1)" };
    expect(errorMessage(sneaky)).toBe("unexpected error");
    expect(errorMessage(undefined)).toBe("unexpected error");
    expect(errorMessage({ message: "looks like an error but is not" })).toBe("unexpected error");
  });

  it("does NOT forward a thrown string, which would re-introduce taint", () => {
    // The tempting version of this helper returns a thrown string verbatim. Against the real
    // CodeQL query that re-opens js/stack-trace-exposure, so the contract is: a string that
    // arrived as a value is not a client message.
    expect(errorMessage("Error: boom\n    at x (/srv/app/lib/file.ts:1:1)")).toBe("unexpected error");
  });

  it("bounds the response body", () => {
    expect(errorMessage(new Error("x".repeat(900)))).toHaveLength(500);
    expect(errorMessage(new Error("x".repeat(900)), 20)).toHaveLength(20);
  });
});

describe("clientMessage", () => {
  it("passes a code the caller wrote", () => {
    expect(clientMessage("operator_required")).toBe("operator_required");
  });

  it("bounds the response body", () => {
    expect(clientMessage("y".repeat(900))).toHaveLength(500);
  });
});

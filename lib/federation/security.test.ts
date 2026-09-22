import { describe, expect, it } from "vitest";
import {
  parseBatonMcpResult,
  safeFederationError,
  safeFederationResult,
  validateFederationArguments,
} from "./security";

describe("Batonly federation security boundary", () => {
  it("accepts bounded metadata and refuses credential-shaped inputs", () => {
    expect(validateFederationArguments({ project: "baton", limit: 5, nested: { dryRun: true } })).toEqual({
      project: "baton",
      limit: 5,
      nested: { dryRun: true },
    });
    expect(() => validateFederationArguments({ api_key: "abc" })).toThrow(/credential-shaped|secret_input_forbidden/i);
    expect(() => validateFederationArguments({ nested: { password: "abc" } })).toThrow(/credential-shaped|secret_input_forbidden/i);
    expect(() => validateFederationArguments({ value: "Bearer abc123" })).toThrow(/credential/i);
    expect(() => validateFederationArguments({ headers: { x: "y" } })).toThrow(/credential-shaped/i);
  });

  it("redacts secret-shaped outputs and bounds error text", () => {
    const safe = safeFederationResult({ ok: true, accessToken: "abc", nested: { api_key: "def" } });
    expect(JSON.parse(safe.json)).toEqual({ ok: true, accessToken: "[redacted]", nested: { api_key: "[redacted]" } });
    expect(safeFederationError(new Error("Bearer abc123"))).toBe("[redacted]");
  });

  it("unwraps Batonly MCP text envelopes", () => {
    expect(parseBatonMcpResult({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })).toEqual({ ok: true });
  });
});

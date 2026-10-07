import { describe, expect, it } from "vitest";
import { receiptRedactor } from "./receipt-redaction";
describe("typed workflow receipt secrets", () => {
  it.each(["ab", 928731, true, null, {nested: ["tiny", 273891]}])("redacts secret values under arbitrary keys: %j", secret => {
    const redactor = receiptRedactor([secret]);
    const rendered = JSON.stringify(redactor.value({result: secret}));
    expect(rendered).toContain("[REDACTED]");
    if (typeof secret === "string" || typeof secret === "number") expect(rendered).not.toContain(String(secret));
  });
  it("redacts structured secret leaves and stringified numbers from error text", () => {
    const redact = receiptRedactor([{nested: {value: "tiny"}, n: 928731}]);
    expect(redact.text("failed tiny / 928731")).toBe("failed [REDACTED] / [REDACTED]");
    expect(redact.value({safe: "public", data: {leaf: "tiny", count: 928731}})).toEqual({safe:"public", data:{leaf:"[REDACTED]", count:"[REDACTED]"}});
  });
  it("escapes regex syntax and never re-redacts its own marker", () => {
    expect(receiptRedactor([".*", "a", "RED"]).text(".* a RED")).toBe("[REDACTED] [REDACTED] [REDACTED]");
  });
});

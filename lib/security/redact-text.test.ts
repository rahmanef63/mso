import { describe, expect, it } from "vitest";
import { redactText } from "./redact-text";
describe("complete authorization redaction", () => {
  it.each(["Authorization: Basic cHJpdmF0ZTpwYXNz", '"Authorization": "Digest username=private, response=secret"', "AUTHORIZATION=Custom private credential"])("scrubs the full header %s", input => {
    const output = redactText(input + "\nordinary source code");
    expect(output).not.toMatch(/cHJpdmF0ZTpwYXNz|username=private|response=secret|private credential/);
    expect(output).toContain("ordinary source code"); expect(redactText(output)).toBe(output);
  });
});

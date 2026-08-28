import { describe, expect, it } from "vitest";
import { safeEmbedUrl } from "./embed-url";

describe("widget embed URL boundary", () => {
  it("accepts normalized external HTTPS URLs", () => {
    expect(safeEmbedUrl(" https://example.com/path?q=1 ", "https://mso.example"))
      .toBe("https://example.com/path?q=1");
  });

  it.each([
    "http://example.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user:pass@example.com",
    "https://mso.example/private",
    "not a url",
    "",
  ])("rejects unsafe embed %s", (value) => {
    expect(safeEmbedUrl(value, "https://mso.example")).toBeNull();
  });

  it("caps attacker-controlled URL length", () => {
    expect(safeEmbedUrl(`https://example.com/${"a".repeat(2100)}`, "https://mso.example")).toBeNull();
  });
});

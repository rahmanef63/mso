import { describe, expect, it } from "vitest";
import { assistantTabFromPayload } from "./navigation";

describe("assistant deep-link payload", () => {
  it("opens the MCP activity tab for /assistant/mcp", () => {
    expect(assistantTabFromPayload({ path: "/mcp" })).toBe("mcp");
  });

  it("fails back to chat for absent or unknown paths", () => {
    expect(assistantTabFromPayload(undefined)).toBe("chat");
    expect(assistantTabFromPayload({ path: "/unknown" })).toBe("chat");
  });
});

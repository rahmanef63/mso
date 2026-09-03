import { describe, expect, it } from "vitest";
import { detectMcpToolProfile } from "./client-profile";

describe("MCP client profile detection", () => {
  it("recognizes the current ChatGPT connector callback host", () => {
    expect(detectMcpToolProfile({ redirectUris: ["https://chatgpt.com/connector/oauth/callback-123"] })).toBe("chatgpt");
  });

  it("recognizes a legacy registered ChatGPT client by name", () => {
    expect(detectMcpToolProfile({ clientId: "mcpc_legacy", name: "ChatGPT" })).toBe("chatgpt");
  });

  it("keeps generic MCP clients on the full MSO catalog", () => {
    expect(detectMcpToolProfile({ clientId: "mcpc_generic", name: "Cursor", redirectUris: ["https://example.com/oauth/callback"] })).toBe("full");
  });
});

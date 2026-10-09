import { describe, expect, it } from "vitest";
import { detectMcpToolProfile } from "./client-profile";

describe("MCP client profile detection", () => {
  it("recognizes a ChatGPT callback as a catalog hint", () => {
    const input = { redirectUris: ["https://chatgpt.com/connector/oauth/callback-123"] };
    expect(detectMcpToolProfile(input)).toBe("chatgpt");
  });

  it("keeps legacy name-only ChatGPT compatibility without using the self-declared name as a file trust signal", () => {
    const input = { clientId: "mcpc_legacy", name: "ChatGPT", redirectUris: ["https://example.com/oauth/callback"] };
    expect(detectMcpToolProfile(input)).toBe("chatgpt");
  });

  it("keeps generic MCP clients on the full MSO catalog and outside ChatGPT file trust", () => {
    const input = { clientId: "mcpc_generic", name: "Cursor", redirectUris: ["https://example.com/oauth/callback"] };
    expect(detectMcpToolProfile(input)).toBe("full");
  });
});

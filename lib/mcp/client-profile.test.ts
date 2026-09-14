import { describe, expect, it } from "vitest";
import { detectMcpToolProfile, isTrustedOpenAiFileParamsClient } from "./client-profile";

describe("MCP client profile detection", () => {
  it("recognizes the current ChatGPT connector callback host and trusts fileParams provenance", () => {
    const input = { redirectUris: ["https://chatgpt.com/connector/oauth/callback-123"] };
    expect(detectMcpToolProfile(input)).toBe("chatgpt");
    expect(isTrustedOpenAiFileParamsClient(input)).toBe(true);
  });

  it("keeps legacy name-only ChatGPT compatibility without using the self-declared name as a file trust signal", () => {
    const input = { clientId: "mcpc_legacy", name: "ChatGPT", redirectUris: ["https://example.com/oauth/callback"] };
    expect(detectMcpToolProfile(input)).toBe("chatgpt");
    expect(isTrustedOpenAiFileParamsClient(input)).toBe(false);
  });

  it("keeps generic MCP clients on the full MSO catalog and outside ChatGPT file trust", () => {
    const input = { clientId: "mcpc_generic", name: "Cursor", redirectUris: ["https://example.com/oauth/callback"] };
    expect(detectMcpToolProfile(input)).toBe("full");
    expect(isTrustedOpenAiFileParamsClient(input)).toBe(false);
  });
});

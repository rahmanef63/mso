import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const AUTHORIZATION_SERVER = fs.readFileSync(
  path.join(__dirname, "../../app/.well-known/oauth-authorization-server/route.ts"),
  "utf8",
);
const PROTECTED_RESOURCE = fs.readFileSync(
  path.join(__dirname, "../../app/.well-known/oauth-protected-resource/route.ts"),
  "utf8",
);

const EXPECTED_SCOPES = '["read", "write", "exec", "offline_access"]';

describe("OAuth discovery contract", () => {
  it("keeps discovery behind the MCP enable gate", () => {
    for (const source of [AUTHORIZATION_SERVER, PROTECTED_RESOURCE]) {
      expect(source).toContain("if (!mcpEnabled()) return new Response(\"Not Found\", { status: 404 });");
    }
  });

  it("advertises the complete consent vocabulary including exec and offline access", () => {
    for (const source of [AUTHORIZATION_SERVER, PROTECTED_RESOURCE]) {
      expect(source).toContain(`scopes_supported: ${EXPECTED_SCOPES}`);
    }
  });
});

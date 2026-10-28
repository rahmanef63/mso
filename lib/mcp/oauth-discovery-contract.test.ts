import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relPath: string) => {
  const file = path.join(__dirname, relPath);
  const handler = file.replace(/route\.ts$/, "handler.ts");
  return fs.existsSync(handler) ? fs.readFileSync(handler, "utf8") : fs.readFileSync(file, "utf8");
};

const AUTHORIZATION_SERVER = readSource(
  "../../app/.well-known/oauth-authorization-server/route.ts",
);
const PROTECTED_RESOURCE = readSource(
  "../../app/.well-known/oauth-protected-resource/route.ts",
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

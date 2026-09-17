import { describe, expect, it } from "vitest";
import { connectionCatalog, connectionMethods, connectionSources } from "./connection-registry";

describe("integration connection registry", () => {
  it("presents GitHub OAuth routes before the explicit manual token fallback", () => {
    expect(connectionSources("github")).toEqual(["composio", "native-mcp", "direct"]);
    const github = connectionCatalog().find((row) => row.id === "github");
    expect(github?.sources.map((row) => [row.id, row.label])).toEqual([
      ["composio", "Hosted OAuth (Composio)"],
      ["native-mcp", "Provider OAuth / MCP"],
      ["direct", "Manual token fallback"],
    ]);
    expect(connectionMethods("github", "direct")[0]?.label).toBe("Personal access token fallback");
  });

  it("does not reorder unrelated providers", () => {
    expect(connectionSources("vercel")).toEqual(["direct", "composio", "native-mcp"]);
  });
});

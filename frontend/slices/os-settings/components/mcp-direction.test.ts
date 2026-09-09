import { describe, expect, it } from "vitest";
import { pagesForDirection } from "./mcp-navigation";
describe("MCP direction navigation", () => {
  it("keeps external clients accessing MSO in the inbound direction", () => expect(pagesForDirection("inbound").map(page => page.id)).toEqual(["connect", "access", "activity", "tools", "connection"]));
  it("keeps registry declarations in the outbound direction", () => expect(pagesForDirection("outbound").map(page => page.id)).toEqual(["registry"]));
});

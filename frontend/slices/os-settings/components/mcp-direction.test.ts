import { describe, expect, it } from "vitest";
import { mcpBreadcrumbs, pagesForDirection } from "./mcp-navigation";
describe("MCP direction navigation", () => {
  it("keeps external clients accessing MSO in the inbound direction", () => expect(pagesForDirection("inbound").map(page => page.id)).toEqual(["connect", "access", "activity", "tools", "connection"]));
  it("keeps registry declarations in the outbound direction", () => expect(pagesForDirection("outbound").map(page => page.id)).toEqual(["registry"]));
  it("omits breadcrumbs on the overview and names the open page", () => {
    expect(mcpBreadcrumbs("overview", () => {})).toBeUndefined();
    expect(mcpBreadcrumbs("tools", () => {})?.map((item) => item.label)).toEqual(["MCP", "Tools & updates"]);
  });
});

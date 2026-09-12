import { describe, expect, it } from "vitest";
import { MCP_PROTOCOL_LATEST, MCP_PROTOCOLS, negotiateMcpProtocol, supportedMcpProtocol } from "./protocol";

describe("MCP protocol era", () => {
  it("advertises both eras without counter-offering modern initialize", () => {
    expect(MCP_PROTOCOL_LATEST).toBe("2026-07-28");
    expect(MCP_PROTOCOLS).toEqual(["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"]);
    expect(supportedMcpProtocol("2026-07-28")).toBe(true);
  });

  it("never counter-offers the stateless revision from initialize", () => {
    expect(negotiateMcpProtocol("2026-07-28")).toBe("2025-06-18");
    expect(negotiateMcpProtocol("2025-06-18")).toBe("2025-06-18");
  });
});

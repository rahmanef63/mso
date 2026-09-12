import { describe, expect, it } from "vitest";
import { validateMcpRequest, modernMcpResult, decodeMcpHeader } from "./modern-http";
const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
const req = (extra = {}) => new Request("https://mso.test/mcp", { method: "POST", headers: { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/call", "Mcp-Name": "weather", ...extra } });
const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "weather", _meta: meta } };
describe("modern MCP HTTP", () => {
  it("validates each independent request, header equality and required capabilities", () => {
    expect(validateMcpRequest(req(), body)).toEqual({ modern: true });
    expect(validateMcpRequest(req({ "Mcp-Name": "other" }), body).error).toMatchObject({ error: { code: -32020 } });
    expect(validateMcpRequest(req(), { ...body, params: { name: "weather", _meta: {} } }).error).toMatchObject({ error: { code: -32602 } });
    expect(validateMcpRequest(req({ "MCP-Protocol-Version": "2099-01-01" }), body).error).toMatchObject({ error: { code: -32022, data: { requested: "2099-01-01" } } });
    expect(validateMcpRequest(new Request("https://mso.test/mcp"), {...body, params: {_meta: {...meta, "io.modelcontextprotocol/protocolVersion":"2099-01-01"}}}).error).toMatchObject({error:{code:-32022}});
    for (const invalid of [null, [], "tools/list", { method: "tools/list", params: [] }]) expect(validateMcpRequest(req(), invalid).error).toBeDefined();
  });
  it("decodes sentinels and decorates only result envelopes", () => {
    expect(decodeMcpHeader("=?base64?" + Buffer.from(" hello 世界 ").toString("base64") + "?=")).toBe(" hello 世界 ");
    expect(decodeMcpHeader("=?base64?bad!?=")).toBeNull();
    expect(modernMcpResult({ result: { content: [] } }, "1").result).toMatchObject({ resultType: "complete" });
    expect(modernMcpResult({ error: { code: -32601 } }, "1")).toEqual({ error: { code: -32601 } });
  });
});

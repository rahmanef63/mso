import { expect, it } from "vitest";
import { projectMcpResult } from "./project-mcp-result";
it("preserves rich results and downstream errors without granting a canvas origin", () => {
  const content = [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }, { type: "audio", mimeType: "audio/wav", data: "aGVsbG8=" }, { type: "resource_link", uri: "https://example.com/file", name: "file" }];
  const result = projectMcpResult({ content, isError: true, structuredContent: { id: 1 }, _meta: { ui: { resourceUri: "ui://untrusted" } } });
  expect(result.content).toEqual(content); expect(result.isError).toBe(true);
  expect(result.meta).toEqual({ "mso/downstream": { ui: { resourceUri: "ui://untrusted" } } });
  expect(() => projectMcpResult({ content: [{ type: "image" }] })).toThrow("malformed");
});

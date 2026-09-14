import { expect, it } from "vitest";
import { projectMcpResult, projectMcpStructuredProjection } from "./project-mcp-result";
it("preserves rich results and downstream errors without granting a canvas origin", () => {
  const content = [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }, { type: "audio", mimeType: "audio/wav", data: "aGVsbG8=" }, { type: "resource_link", uri: "https://example.com/file", name: "file" }];
  const result = projectMcpResult({ content, isError: true, structuredContent: { id: 1 }, _meta: { ui: { resourceUri: "ui://untrusted" } } });
  expect(result.content).toEqual(content); expect(result.isError).toBe(true);
  expect(result.meta).toEqual({ "mso/downstream": { ui: { resourceUri: "ui://untrusted" } } });
  expect(() => projectMcpResult({ content: [{ type: "image" }] })).toThrow("malformed");
});

it("projects downstream text and metadata into structured output without duplicating binary payloads", () => {
  const raw = projectMcpResult({ content: [
    { type: "text", text: "{\"ok\":true}" },
    { type: "image", mimeType: "image/png", data: "base64-secret-binary" },
    { type: "resource_link", uri: "https://example.com/file", name: "file" },
    { type: "resource", resource: { uri: "mcp://text", text: "hello", mimeType: "text/plain" } },
    { type: "resource", resource: { uri: "mcp://blob", blob: "base64-resource-binary", mimeType: "application/octet-stream" } },
  ], structuredContent: { id: 1 } });
  const projected = projectMcpStructuredProjection(raw);
  expect(projected).toMatchObject({
    content: [
      { type: "text", text: "{\"ok\":true}" },
      { type: "image", mimeType: "image/png", binaryOmitted: true },
      { type: "resource_link", uri: "https://example.com/file", name: "file" },
      { type: "resource", resource: { uri: "mcp://text", text: "hello", mimeType: "text/plain" } },
      { type: "resource", resource: { uri: "mcp://blob", binaryOmitted: true, mimeType: "application/octet-stream" } },
    ],
    structuredContent: { id: 1 },
  });
  expect(JSON.stringify(projected)).not.toContain("base64-secret-binary");
  expect(JSON.stringify(projected)).not.toContain("base64-resource-binary");
});

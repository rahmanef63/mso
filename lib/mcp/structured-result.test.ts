import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { structuredResult } = await import("./dispatch-tool-support");
const { mcpDirect } = await import("./tool-kit");

describe("profile-aware MCP structured results", () => {
  it("wraps dynamic ChatGPT results once while preserving generic MCP text", () => {
    const raw = { entries: [{ name: "a", type: "file" }] };
    const chat = structuredResult("fs_list", raw, "chatgpt") as { structuredContent?: unknown; content: Array<{ text: string }> };
    expect(chat.structuredContent).toEqual({ result: raw });
    expect(chat.content[0].text).toBe("Structured result returned by fs_list.");
    const full = structuredResult("fs_list", raw, "full") as { structuredContent?: unknown; content: Array<{ text: string }> };
    expect(full.structuredContent).toBeUndefined();
    expect(JSON.parse(full.content[0].text)).toEqual(raw);
  });

  it("normalizes undefined handler output to JSON null", () => {
    const chat = structuredResult("fs_list", undefined, "chatgpt") as { structuredContent?: unknown };
    expect(chat.structuredContent).toEqual({ result: null });
    const full = structuredResult("fs_list", undefined, "full") as { content: Array<{ text: string }> };
    expect(full.content[0].text).toBe("null");
  });

  it("keeps direct binary content outside structuredContent", () => {
    const direct = mcpDirect([{ type: "image", data: "base64-image-data", mimeType: "image/png" }], false, { result: { width: 10, height: 20 } });
    const chat = structuredResult("screen_capture", direct, "chatgpt") as { structuredContent?: unknown; content: Array<Record<string, unknown>> };
    expect(chat.structuredContent).toEqual({ result: { width: 10, height: 20 } });
    expect(JSON.stringify(chat.structuredContent)).not.toContain("base64-image-data");
    expect(chat.content[0]).toMatchObject({ type: "image", data: "base64-image-data" });
  });
});

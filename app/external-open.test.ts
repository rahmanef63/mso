import { describe, expect, it } from "vitest";
import { chatGptMcpLanding } from "./external-open";

describe("ChatGPT MCP external landing", () => {
  it("turns a root ChatGPT conversation redirect into the visible MCP activity deep-link", () => {
    const source = "https://chatgpt.com/c/6a996289-c858-83ec-b706-fedf850aa375";
    expect(chatGptMcpLanding(undefined, source)).toBe(`/assistant/mcp?redirectUrl=${encodeURIComponent(source)}`);
  });

  it("does not hijack normal MSO roots, app deep-links, or foreign redirect URLs", () => {
    expect(chatGptMcpLanding(undefined, undefined)).toBeNull();
    expect(chatGptMcpLanding(["files"], "https://chatgpt.com/c/abc")).toBeNull();
    expect(chatGptMcpLanding(undefined, "https://example.com/c/abc")).toBeNull();
    expect(chatGptMcpLanding(undefined, "https://chatgpt.com/g/gpt-id")).toBeNull();
  });
});

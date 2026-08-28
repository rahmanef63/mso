import { describe, expect, it } from "vitest";
import { hybridSemanticScore } from "./semantic";

describe("local skill embeddings", () => {
  it("routes Indonesian screenshot language to screen capture", () => {
    const query = "kirim tangkapan layar macOS dan link download sementara";
    const screenshot = hybridSemanticScore(query, "screen_capture Capture the authenticated MSO desktop and return a temporary preview download link");
    const disk = hybridSemanticScore(query, "fs_usage Show total used and free disk bytes");
    expect(screenshot).toBeGreaterThan(disk + 0.2);
  });

  it("connects workflow/recipe phrasing across Indonesian and English", () => {
    const score = hybridSemanticScore("ingat cara tercepat agar task berikutnya lebih cepat", "workflow recipe skill memory fastest successful path");
    expect(score).toBeGreaterThan(0.25);
  });
});

describe("bounded prepared semantic queries", () => {
  it("rejects oversized owner intent before embedding", async () => {
    const { prepareSemanticQuery, MAX_SEMANTIC_QUERY_BYTES } = await import("./semantic");
    expect(() => prepareSemanticQuery("x".repeat(MAX_SEMANTIC_QUERY_BYTES + 1))).toThrow(/byte limit/);
  });

  it("reuses one prepared query vector across candidate scoring", async () => {
    const { prepareSemanticQuery, hybridSemanticScore } = await import("./semantic");
    const prepared = prepareSemanticQuery("deploy mso safely");
    const identity = prepared.vector;
    hybridSemanticScore(prepared, "deploy release workflow");
    hybridSemanticScore(prepared, "unrelated media editor");
    expect(prepared.vector).toBe(identity);
  });
});

import { describe, expect, it } from "vitest";
import { projectFunctionContent } from "./project-function-content";

const image = { type: "image", mimeType: "image/png", data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64") };
const envelope = (content: unknown[]) => ({ code: 0, stdout: JSON.stringify({ protocol: "mso.project-function-content.v1", content }), stderr: "" });

describe("project-function direct content boundary", () => {
  it("promotes exactly one signature-matched supported image", () => {
    const result = projectFunctionContent(envelope([image, { type: "text", text: "fixture" }]));
    expect(result).toHaveProperty("content"); expect(result).toHaveProperty("code", 0);
  });
  it.each([
    [], [image, image], [{ ...image, mimeType: "image/svg+xml" }], [{ ...image, data: "not_base64" }],
    [{ ...image, data: Buffer.from("not an image").toString("base64") }],
    [image, { type: "text", text: "x".repeat(32769) }],
    [image, ...Array.from({ length: 4 }, () => ({ type: "text", text: "extra" }))],
    [{ ...image, data: Buffer.alloc(621 * 1024).toString("base64") }],
  ].map((content) => [content]))("keeps malformed or oversized content as the original process envelope %#", (content) => {
    const original = envelope(content); expect(projectFunctionContent(original)).toBe(original);
  });
  it("does not promote nonzero exits, stderr, wrong protocols or non-JSON output", () => {
    for (const original of [
      { ...envelope([image]), code: 1 }, { ...envelope([image]), stderr: "warning" },
      { code: 0, stdout: "not-json", stderr: "" },
      { code: 0, stdout: JSON.stringify({ protocol: "other", content: [image] }), stderr: "" },
    ]) expect(projectFunctionContent(original)).toBe(original);
  });
});

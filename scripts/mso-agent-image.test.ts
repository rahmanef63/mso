import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  pendingImageBlock,
  validateImagePath,
} from "./mso-agent-image.mjs";

describe("MSO Agent image", () => {
  let tmpDir: string;
  let testPng: string;
  let testTxt: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-img-test-"));
    testPng = path.join(tmpDir, "sample.png");
    testTxt = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(testPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(testTxt, "plain text");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extension validation accepts .png", () => {
    const valid = validateImagePath(testPng);
    expect(valid.ok).toBe(true);
    expect(valid.ext).toBe(".png");
    expect(valid.size).toBe(4);
  });

  it("extension validation rejects a .txt file", () => {
    const res = validateImagePath(testTxt);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("unsupported image format");
  });

  it("extension validation rejects a directory", () => {
    const res = validateImagePath(tmpDir);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not a regular file");
  });

  it("extension validation rejects missing file", () => {
    const res = validateImagePath(path.join(tmpDir, "nonexistent.png"));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("file not found");
  });

  it("allows standard image extensions in set", () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".png")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".jpg")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".jpeg")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".gif")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".webp")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".svg")).toBe(false);
  });

  it("pendingImageBlock returns empty string for empty or missing list", () => {
    expect(pendingImageBlock([])).toBe("");
    expect(pendingImageBlock(null)).toBe("");
    expect(pendingImageBlock(undefined)).toBe("");
  });

  it("pendingImageBlock lists remote paths with clear delimiter", () => {
    const images = [
      { path: "/tmp/a.png", remotePath: "/artifacts/a.png", bytes: 100 },
      { path: "/tmp/b.jpg", remotePath: "/artifacts/b.jpg", bytes: 200 },
    ];
    const block = pendingImageBlock(images);
    expect(block).toContain("--- ATTACHED IMAGES ---");
    expect(block).toContain("/artifacts/a.png");
    expect(block).toContain("/artifacts/b.jpg");
    expect(block).toContain("------------------------");
  });

  // Regression: /image used to upload and then strand the file in session.pendingImages,
  // because the prompt loop never read it. The block must reach the user message.
  it("the prompt loop prepends pending images and clears them", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/mso-agent.mjs"), "utf8");
    // The block is built from session.pendingImages and folded into the history row.
    expect(source).toMatch(/pendingImageBlock\(images\)/);
    expect(source).toMatch(/role: "user", text: imageBlock \?/);
    // The list is cleared in the same breath, so an image cannot ride along twice.
    expect(source).toMatch(/session\.pendingImages = \[\]/);
    // And the import is real, not a dead reference.
    expect(source).toMatch(/import \{ pendingImageBlock \} from "\.\/mso-agent-image\.mjs"/);
  });
});

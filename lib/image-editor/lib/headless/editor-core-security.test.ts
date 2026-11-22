import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "./editor-core";
import { blankDoc, createLayer } from "../model";
import { IMAGE_EDITOR_LIMITS } from "../project-validation";

describe("headless editor resource boundary", () => {
  it("rejects unsafe initial documents", () => {
    const doc = blankDoc();
    doc.width = Infinity;
    expect(() => createHeadlessEditor(doc)).toThrow(/canvas width/);
  });

  it("blocks resize and crop before committing an unsafe document", () => {
    const editor = createHeadlessEditor(blankDoc());
    expect(() => (editor.setDocSize as (w: number, h: number) => void)(IMAGE_EDITOR_LIMITS.maxCanvasDimension + 1, 1)).toThrow();
    expect(() => (editor.applyCrop as (x: number, y: number, w: number, h: number) => void)(0, 0, Infinity, 100)).toThrow();
    expect(editor.doc).toMatchObject({ width: 1080, height: 1080 });
  });

  it("enforces the layer limit on command-style mutations", () => {
    const doc = blankDoc();
    doc.layers = Array.from({ length: IMAGE_EDITOR_LIMITS.maxLayers }, (_, i) => createLayer("paint", { name: String(i) }));
    const editor = createHeadlessEditor(doc);
    expect(() => (editor.addLayer as (layer: ReturnType<typeof createLayer>) => void)(createLayer("paint"))).toThrow(/layer limit/);
  });
});

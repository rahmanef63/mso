import { describe, expect, it } from "vitest";
import { blankDoc, createLayer } from "./model";
import {
  IMAGE_EDITOR_LIMITS,
  assertImageCanvasBounds,
  parseImageEditorProject,
  readBoundedProjectResponse,
  validateImageEditorDoc,
  validateImageEditorProject,
} from "./project-validation";

function validProject() {
  const doc = blankDoc(1080, 1080);
  return { v: 1 as const, doc, paint: {} };
}

function chunked(...chunks: Uint8Array[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
}

describe("image-editor project validation", () => {
  it("accepts and canonicalizes a valid full project and bare Doc", () => {
    const full = validateImageEditorProject(validProject());
    expect(full).toMatchObject({ v: 1, doc: { width: 1080, height: 1080 }, paint: {} });
    const bare = validateImageEditorProject(full.doc);
    expect(bare).toMatchObject({ v: 1, doc: { width: 1080, height: 1080 }, paint: {} });
  });

  it("rejects non-finite, fractional, zero and over-budget canvases", () => {
    for (const [width, height] of [
      [Infinity, 100], [NaN, 100], [100.5, 100], [0, 100], [-1, 100],
      [IMAGE_EDITOR_LIMITS.maxCanvasDimension + 1, 1],
    ]) expect(() => assertImageCanvasBounds(width, height)).toThrow();
    expect(() => assertImageCanvasBounds(4096, 4096)).not.toThrow();
  });

  it("rejects excessive layers before iterating their nested content", () => {
    const project = validProject();
    project.doc.layers = Array.from(
      { length: IMAGE_EDITOR_LIMITS.maxLayers + 1 },
      (_, index) => createLayer("paint", { name: `layer-${index}` }),
    );
    expect(() => validateImageEditorProject(project)).toThrow(/layer limit/);
  });

  it("rejects duplicate ids and malformed nested layer objects", () => {
    const project = validProject();
    const duplicate = createLayer("text", { id: project.doc.layers[0]!.id });
    // createLayer always refreshes ids, so set the duplicate after construction.
    duplicate.id = project.doc.layers[0]!.id;
    project.doc.layers.push(duplicate);
    expect(() => validateImageEditorProject(project)).toThrow(/duplicate layer id/);

    const malformed = validProject();
    (malformed.doc.layers[0]!.style.shadow as unknown as { opacity: number }).opacity = 99;
    expect(() => validateImageEditorProject(malformed)).toThrow(/opacity/);
  });

  it("rejects executable image data and paint keys that do not map to paint layers", () => {
    const svg = validProject();
    svg.doc.layers.push(createLayer("image", {
      src: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+",
    }));
    expect(() => validateImageEditorProject(svg)).toThrow(/base64 raster image/);

    const mismatch = validProject();
    (mismatch.paint as Record<string, string>).unknown = "data:image/png;base64,AA==";
    expect(() => validateImageEditorProject(mismatch)).toThrow(/non-paint layer/);
  });

  it("rejects non-finite transforms and adjustment payloads", () => {
    const transform = validProject();
    transform.doc.layers[0]!.t.scaleX = Infinity;
    expect(() => validateImageEditorDoc(transform.doc)).toThrow(/scaleX/);

    const adjustment = validProject();
    adjustment.doc.layers[0]!.adj.blur = 10_000;
    expect(() => validateImageEditorDoc(adjustment.doc)).toThrow(/blur/);
  });

  it("parses a valid project and rejects malformed JSON", () => {
    expect(parseImageEditorProject(JSON.stringify(validProject())).doc.width).toBe(1080);
    expect(() => parseImageEditorProject("{broken")).toThrow(/malformed/);
  });

  it("rejects a declared oversized response without opening its body", async () => {
    const getReader = () => { throw new Error("body must not be read"); };
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(IMAGE_EDITOR_LIMITS.maxProjectBytes + 1) }),
      body: { getReader },
    } as unknown as Response;
    await expect(readBoundedProjectResponse(response)).rejects.toThrow(/byte limit/);
  });

  it("stops a chunked response as soon as the project byte cap is crossed", async () => {
    const first = new Uint8Array(IMAGE_EDITOR_LIMITS.maxProjectBytes);
    const second = new Uint8Array(1);
    await expect(readBoundedProjectResponse(chunked(first, second))).rejects.toThrow(/byte limit/);
  });
});

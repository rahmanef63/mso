import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDrawingLayer, insertTextLayer, moveLayerBy, patchAdjustment, removeLayer, updateLayer,
} from "../src/lib/creative/image-editor-layer-ops.ts";
import { handleEditorKey } from "../src/lib/creative/image-editor-keys.ts";
import { createBlankDocument } from "../src/lib/creative/image-editor-state.ts";
import type { EditorTool } from "../src/lib/creative/image-editor-types.ts";

test("layer ops clamp text size, insert layers, move overlays, and never drop the last layer", () => {
  const doc = createBlankDocument(640, 480);
  const withText = insertTextLayer(doc, { x: 10.4, y: 20.6 }, {
    text: "  ", fontSize: 900, fontWeight: "700", color: "#fff",
  });
  const text = withText.doc.layers.at(-1);
  assert.equal(text?.kind, "text");
  if (text?.kind === "text") {
    assert.equal(text.x, 10);
    assert.equal(text.y, 21);
    assert.equal(text.text, "Text");
    assert.equal(text.fontSize, 144);
  }

  const moved = moveLayerBy(withText.doc, withText.layerId, 5, -5);
  const movedText = moved.layers.at(-1);
  assert.equal(movedText?.kind === "text" ? movedText.x : null, 15);

  const draw = addDrawingLayer(moved);
  assert.equal(draw.doc.layers.length, 3);
  const patched = patchAdjustment(draw.doc, "brightness", 140);
  assert.equal(patched.adjustments.brightness, 140);

  const renamed = updateLayer(patched, draw.layerId, (layer) => ({ ...layer, name: "Ink" }));
  assert.equal(renamed.layers.at(-1)?.name, "Ink");

  const pruned = removeLayer(renamed, draw.layerId);
  assert.equal(pruned.layers.length, 2);
  const single = createBlankDocument(64, 64);
  assert.equal(removeLayer(single, single.layers[0]!.id).layers.length, 1);
});

test("editor keyboard handler maps tool shortcuts, ignores inputs, and routes undo and redo", () => {
  const calls: string[] = [];
  const target = {
    undo: () => calls.push("undo"),
    redo: () => calls.push("redo"),
    selectTool: (tool: EditorTool) => calls.push(`tool:${tool}`),
  };
  const fire = (key: string, init: Record<string, unknown> = {}, tagName = "DIV") => {
    handleEditorKey({ key, target: { tagName }, ...init }, target);
  };

  fire("b");
  fire("S", { shiftKey: true });
  fire("z", { ctrlKey: true });
  fire("z", { metaKey: true, shiftKey: true });
  fire("b", {}, "INPUT");
  fire("x");

  assert.deepEqual(calls, ["tool:brush", "tool:shape", "undo", "redo"]);
});

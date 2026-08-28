"use client";

import { useCallback } from "react";
import type { Doc, Layer } from "./types";
import { createLayer } from "./model";
import { maskKey } from "./mask";
import { assertImageCanvasBounds } from "./project-validation";

type SetDoc = (next: Doc | ((d: Doc) => Doc), track?: boolean) => void;

// Layer-array operations (add/remove/duplicate/reorder/raise/lower) + canvas
// size, factored out of the store to keep store.tsx under the 200-LOC cap. All
// route through `setDoc` so they share immutability + the undo timeline.
export function useDocOps(
  setDoc: SetDoc,
  canvases: React.MutableRefObject<Map<string, HTMLCanvasElement>>,
  setSelectedId: (id: string | null | ((s: string | null) => string | null)) => void,
) {
  // Copy the offscreen canvas at `fromKey` into a same-size canvas at `toKey`
  // (no-op if the source is absent). Used to carry paint/mask pixels when a layer
  // is duplicated, since the doc snapshot doesn't include bitmaps.
  const cloneCanvas = useCallback((fromKey: string, toKey: string) => {
    const src = canvases.current.get(fromKey);
    if (!src) return;
    const dst = document.createElement("canvas");
    dst.width = src.width;
    dst.height = src.height;
    dst.getContext("2d")?.drawImage(src, 0, 0);
    canvases.current.set(toKey, dst);
  }, [canvases]);

  const addLayer = useCallback((layer: Layer, opts?: { select?: boolean }) => {
    setDoc((d) => ({ ...d, layers: [...d.layers, layer] }));
    if (opts?.select !== false) setSelectedId(layer.id);
  }, [setDoc, setSelectedId]);

  const removeLayer = useCallback((id: string) => {
    // DON'T dispose the offscreen paint/mask canvases here: removal is a single
    // tracked doc step whose snapshot has no pixels (they live in the canvas map,
    // keyed by id). Deleting them now would make undo restore a BLANK layer.
    // Keeping them means undoing the doc step re-finds the same-id canvas with its
    // pixels intact. Orphans never leak into Save/autosave — buildProject only
    // serializes canvases for layers still present in doc.layers.
    setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  }, [setDoc, setSelectedId]);

  const duplicateLayer = useCallback((id: string) => {
    setDoc((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      if (i < 0) return d;
      const src = d.layers[i];
      const copy = createLayer(src.kind, { ...src, name: `${src.name} copy`, t: { ...src.t, x: src.t.x + 24, y: src.t.y + 24 } });
      // Paint layers (and any layer mask) keep their pixels in offscreen canvases
      // keyed by id, which the doc snapshot doesn't carry — so a fresh-id copy is
      // blank unless we clone those bitmaps too. Copy the source paint canvas and,
      // if present, the mask canvas into the new id.
      cloneCanvas(src.id, copy.id);
      cloneCanvas(maskKey(src.id), maskKey(copy.id));
      return { ...d, layers: [...d.layers.slice(0, i + 1), copy, ...d.layers.slice(i + 1)] };
    });
  }, [setDoc, cloneCanvas]);

  const reorder = useCallback((from: number, to: number) => {
    setDoc((d) => {
      const ls = [...d.layers];
      const [m] = ls.splice(from, 1);
      ls.splice(to, 0, m);
      return { ...d, layers: ls };
    });
  }, [setDoc]);

  const move = useCallback((id: string, dir: 1 | -1) => {
    setDoc((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.layers.length) return d;
      const ls = [...d.layers];
      [ls[i], ls[j]] = [ls[j], ls[i]];
      return { ...d, layers: ls };
    });
  }, [setDoc]);

  // NOTE: resizing the doc doesn't resize paint/mask offscreen canvases, so
  // after a size change the brush paints onto a stale-sized buffer (and the
  // mask is mis-aligned). A fix needs a re-baked canvas per paint layer + a
  // paired history entry — a larger change touching the undo model, deferred.
  const setDocSize = useCallback((w: number, h: number) => {
    assertImageCanvasBounds(w, h);
    setDoc((d) => ({ ...d, width: w, height: h }));
  }, [setDoc]);

  // Crop: resize the doc to (w,h) anchored at (x,y), shift every layer by (-x,-y),
  // and re-bake each paint layer's pixels into a new (w,h) canvas at the offset.
  // NOTE: the re-bake is DESTRUCTIVE — it overwrites the canvas at the same id
  // while the pushed history step only snapshots the doc, so undoing a crop
  // restores doc dimensions but NOT the pre-crop paint pixels. A correct fix
  // pairs a paint snapshot with the doc step (combined action) — deferred.
  const applyCrop = useCallback((x: number, y: number, w: number, h: number) => {
    if (![x, y].every(Number.isFinite)) throw new Error("crop origin must be finite");
    assertImageCanvasBounds(Math.round(w), Math.round(h));
    setDoc((d) => {
      for (const l of d.layers) {
        if (l.kind !== "paint") continue;
        const old = canvases.current.get(l.id);
        if (!old) continue;
        const nc = document.createElement("canvas");
        nc.width = w;
        nc.height = h;
        nc.getContext("2d")?.drawImage(old, -x, -y);
        canvases.current.set(l.id, nc);
      }
      return {
        ...d,
        width: Math.round(w),
        height: Math.round(h),
        layers: d.layers.map((l) => ({ ...l, t: { ...l.t, x: l.t.x - x, y: l.t.y - y } })),
      };
    });
  }, [setDoc, canvases]);

  return { addLayer, removeLayer, duplicateLayer, reorder, raise: (id: string) => move(id, 1), lower: (id: string) => move(id, -1), setDocSize, applyCrop };
}

"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";
import { useEditor } from "../lib/store";
import type { Layer } from "../lib/types";

// Context published by <ConfirmRemoveLayerProvider> so any layer-delete
// affordance (Backspace handler, layer panel, layer-actions menu) can route
// through ONE confirm gate instead of rolling its own.
type ReqRemove = (layerId: string) => void;
const Ctx = React.createContext<ReqRemove | null>(null);

export function useConfirmRemoveLayer(): ReqRemove {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useConfirmRemoveLayer must be used within <ConfirmRemoveLayerProvider>");
  return ctx;
}

// Heuristic: does this layer hold work the user might mourn? Adjustment layers
// carry tuned filter knobs; image/text/shape layers have authored content; a
// paint layer is "empty" only when its offscreen canvas has zero pixels drawn.
// For paint we sample the bottom-right tail of the buffer (cheap, accurate
// enough — a real paint stroke covers many rows).
function hasContent(layer: Layer, canvas: HTMLCanvasElement | undefined): boolean {
  if (layer.kind === "adjustment") return true;
  if (layer.kind === "image") return Boolean(layer.src);
  if (layer.kind === "text") return Boolean(layer.text && layer.text.length > 0);
  if (layer.kind === "shape") return true;
  if (layer.kind === "paint") {
    if (!canvas) return false;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      // Sample full canvas alpha channel — strides of 16 keep the cost bounded
      // even on a 4K doc (~64KB scanned).
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 16) if (data[i] !== 0) return true;
      return false;
    } catch {
      // CORS-tainted or other read failure → assume content (safer to confirm).
      return true;
    }
  }
  return true;
}

export function ConfirmRemoveLayerProvider({ children }: { children: React.ReactNode }) {
  const { doc, removeLayer, canvasFor } = useEditor();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const layer = pendingId ? doc.layers.find((l) => l.id === pendingId) ?? null : null;

  const request = React.useCallback<ReqRemove>(
    (id) => {
      const target = doc.layers.find((l) => l.id === id);
      if (!target) return;
      const buf = canvasFor(id, doc.width, doc.height);
      if (!hasContent(target, buf)) {
        removeLayer(id);
        return;
      }
      setPendingId(id);
    },
    [doc.layers, doc.width, doc.height, canvasFor, removeLayer],
  );

  const close = React.useCallback(() => setPendingId(null), []);
  const confirm = React.useCallback(() => {
    if (pendingId) removeLayer(pendingId);
    setPendingId(null);
  }, [pendingId, removeLayer]);

  return (
    <Ctx.Provider value={request}>
      {children}
      <FormDrawer open={pendingId !== null} onOpenChange={(open) => !open && close()} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>Delete layer?</FormDrawer.Title>
          <FormDrawer.Description>
            {layer ? `"${layer.name}" will be removed. Undo (Ctrl/⌘+Z) brings it back.` : "This layer will be removed."}
          </FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirm}>
            <Trash2 className="size-4" />
            Delete layer
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </Ctx.Provider>
  );
}

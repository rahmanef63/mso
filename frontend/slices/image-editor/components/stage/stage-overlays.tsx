"use client";

import { Button } from "@/components/ui/button";
import { useEditor } from "../../lib/store";
import type { Doc, Layer, Pan } from "../../lib/types";
import { ZoomHud } from "./zoom-hud";
import { CropOverlay } from "./crop-overlay";
import { SelectionOverlay } from "./selection-overlay";
import { TextOverlay } from "./text-overlay";

type Props = {
  doc: Doc;
  zoom: number;
  pan: Pan;
  pristine: boolean;
  maskEditId: string | null;
  editing: Layer | null;
  colorInput: React.RefObject<HTMLInputElement | null>;
  onPickColor: (v: string) => void;
  onZoomStep: (d: number) => void;
  onFit: () => void;
  onReset: () => void;
  onEditDone: () => void;
};

// DOM overlays that float over the Konva <Stage>: hidden color picker, mask-edit
// cue, first-run hint, zoom HUD, and the crop / selection / text-edit overlays.
// Split out of <EditorStage> purely for file size; behaviour is unchanged.
export function StageOverlays({
  doc, zoom, pan, pristine, maskEditId, editing,
  colorInput, onPickColor, onZoomStep, onFit, onReset, onEditDone,
}: Props) {
  const { tool, setTool, setMaskEdit, update, applyCrop } = useEditor();
  return (
    <>
      {/* Hidden native color picker — opened by double-clicking a shape layer. */}
      <input
        ref={colorInput}
        type="color"
        className="pointer-events-none absolute size-0 opacity-0"
        aria-hidden
        onInput={(e) => onPickColor((e.target as HTMLInputElement).value)}
      />

      {/* Mask-edit cue: the mask surface is invisible, so make the mode obvious +
          give a one-click exit (brush HIDES, eraser REVEALS while this is on). */}
      {maskEditId && (
        <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-warning/80">
          <div className="pointer-events-auto absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-warning/95 px-3 py-1 text-xs font-medium text-black shadow">
            Editing mask: brush hides · eraser reveals
            <Button type="button" variant="ghost" className="h-auto rounded bg-black/20 px-1.5 py-0.5 text-xs font-medium text-black hover:bg-black/30" onClick={() => setMaskEdit(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {/* First-run hint over an untouched canvas — non-blocking (any edit clears it). */}
      {pristine && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-border bg-card/85 px-5 py-4 text-center shadow-sm backdrop-blur">
            <p className="text-sm font-medium text-foreground">Start your image</p>
            <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
              Open an image from <b>File ▸ Open Image</b>, or pick a tool on the left to draw, type, or add a shape.
            </p>
          </div>
        </div>
      )}

      <ZoomHud zoom={zoom} onOut={() => onZoomStep(-1)} onIn={() => onZoomStep(1)} onReset={onReset} onFit={onFit} />

      {tool === "crop" && (
        <CropOverlay
          doc={doc}
          zoom={zoom}
          pan={pan}
          onApply={(x, y, w, h) => { applyCrop(x, y, w, h); setTool("move"); }}
          onCancel={() => setTool("move")}
        />
      )}

      {tool === "select" && <SelectionOverlay onDone={() => setTool("move")} />}

      {editing && (
        <TextOverlay
          layer={editing}
          zoom={zoom}
          pan={pan}
          onChange={(text) => update(editing.id, { text })}
          onDone={onEditDone}
        />
      )}
    </>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { EditorProvider } from "./lib/store";
import { blankDoc, createLayer } from "./lib/model";
import { imageEditorConfig } from "./config";
import { ProjectLoader, ProjectLoadError } from "./components/project-loader";
import { ConfirmRemoveLayerProvider } from "./components/confirm-remove-layer";
import { Shell } from "./shell";
import type { Doc } from "./lib/types";
import type { EditorApi } from "./lib/editor-api";

// The Konva stage touches `window`/`canvas` at import time, so it is loaded
// client-only (no SSR) — the rest of the chrome renders normally.
const EditorStage = dynamic(
  () => import("./components/stage/editor-stage").then((m) => m.EditorStage),
  { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading canvas…</div> },
);

export type ImageEditorProps = {
  /** Optional image to open on mount (data URL / object URL / remote URL). */
  initialImage?: string;
  /**
   * Optional URL to a saved document/project JSON to load on mount — either a
   * full Project ({v:1,doc,paint}) or a bare Doc ({width,height,layers}). This
   * is how a headless-CRUD'd `.doc.json` (built via /api/v1/editor/exec) renders
   * in the REAL editor: "render = open in mso".
   */
  projectSrc?: string;
  /**
   * Optional persistence sink — when set, the editor debounce-saves the current
   * Doc to it (the back half of the round-trip: edits in the real editor flow
   * back to the file a headless CRUD opened). Injected so the slice stays
   * backend-agnostic; the consumer wires it to its file write.
   */
  onSaveDoc?: (doc: Doc) => void;
  /** Optional starting canvas size; defaults to config (1080×1080). */
  width?: number;
  height?: number;
  /** Window id from the host shell — keyboard hotkeys gate on this so Backspace
   *  / ⌘Z / tool keys only fire when THIS editor's window is the OS-focused
   *  one. Without it the editor still works in standalone embeds; the
   *  per-window guard simply degrades to "no editor is currently scoped." */
  winId?: string;
  /** Fired by the Save button with a PNG data URL. Omit to hide Save. */
  onSave?: (dataUrl: string) => void;
  /** Fired by the "Save As" button with a PNG data URL — consumers show a
   * destination picker. Omit to hide Save As. */
  onSaveAs?: (dataUrl: string) => void;
  /** File → Close menu item (consumer closes the window). Omit to hide. */
  onClose?: () => void;
  /** Reports unsaved-changes state so the consumer can guard window close. */
  onDirty?: (dirty: boolean) => void;
  /** Hands the consumer an imperative API (render PNG, mark clean) on mount. */
  onReady?: (api: EditorApi) => void;
  /**
   * Container-first layout override: the host passes its PANE width verdict
   * (e.g. a 390px desktop window) so the compact layout isn't keyed off the
   * viewport alone. Omitted (standalone use) → falls back to useIsMobile().
   */
  compact?: boolean;
  className?: string;
}

export type { EditorApi } from "./lib/editor-api";

// Standalone, self-contained image editor. Drops into any height-bearing box.
export function ImageEditor({ initialImage, projectSrc, onSaveDoc, width, height, onSave, onSaveAs, onClose, onDirty, onReady, compact, className, winId }: ImageEditorProps) {
  const initialDoc = useMemo<Doc>(() => {
    const d = blankDoc(width ?? imageEditorConfig.defaultWidth, height ?? imageEditorConfig.defaultHeight);
    if (initialImage) d.layers.push(createLayer("image", { name: "Image", src: initialImage }));
    return d;
  }, [initialImage, width, height]);
  // When loading a doc from a URL, gate the save-back until the load LANDS. A
  // failed load leaves `ready` false forever so autosave never writes the blank
  // starter over the user's file; the error surfaces inline instead.
  const [ready, setReady] = useState(!projectSrc);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onLoaded = useCallback((ok: boolean, error?: string) => {
    if (ok) { setReady(true); setLoadError(null); }
    else setLoadError(error ?? "Could not open project");
  }, []);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <EditorProvider initialDoc={initialDoc}>
        <ConfirmRemoveLayerProvider>
          {projectSrc && <ProjectLoader src={projectSrc} onDone={onLoaded} />}
          <Shell onSave={onSave} onSaveAs={onSaveAs} onClose={onClose} onDirty={onDirty} onReady={onReady} autoRestore={!initialImage && !projectSrc} saveDoc={onSaveDoc} ready={ready} compact={compact} winId={winId} stage={<EditorStage />} />
        </ConfirmRemoveLayerProvider>
      </EditorProvider>
      {loadError && <ProjectLoadError message={loadError} />}
    </div>
  );
}

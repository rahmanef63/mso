"use client";

import { useEffect, useRef, useState } from "react";
import { ImageEditor, type EditorApi } from "@/features/image-editor";
import { rawUrl } from "./lib/host";
import { closeWindow, setCloseGuard, toast, useContainer, useIsMobile, FormDrawer } from "@/features/os-shell";
import type { AppProps } from "@/features/os-shell";
import { Button } from "@/components/ui/button";
import { SaveImageDialog } from "./components/save-image-dialog";
import { autoName, loadSavePrefs, saveImageToHost } from "./lib/save-image";

// The OS "Image Editor" app — the portable image-editor slice + mso wiring:
// open host images / round-trip a saved doc, SAVE rendered images to a VPS folder,
// and guard window close on unsaved changes (Save / Don't Save / Cancel).
export default function MediaStudio({ payload, winId }: AppProps) {
  const p = payload as { path?: string; name?: string; kind?: string } | undefined;
  const [pending, setPending] = useState<string | null>(null); // PNG awaiting the Save As dialog
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = useRef(false);
  const api = useRef<EditorApi | null>(null);
  const closeAfterSave = useRef(false);
  // Container-first responsiveness: the editor reflows off its PANE width (a
  // 390px desktop window gets the compact layout, not just phones).
  const [paneRef, pane] = useContainer<HTMLDivElement>();
  const isMobile = useIsMobile();
  const compact = isMobile || pane === "xs" || pane === "sm";

  // Register a close guard: if there are unsaved edits, veto the close and show
  // the prompt instead. Cleared on unmount.
  useEffect(() => {
    if (!winId) return;
    setCloseGuard(winId, () => {
      if (!dirty.current) return true;
      setConfirmClose(true);
      return false;
    });
    return () => setCloseGuard(winId, null);
  }, [winId]);

  const markClean = () => { dirty.current = false; api.current?.markSaved(); };
  const forceClose = () => { if (winId) { setCloseGuard(winId, null); closeWindow(winId); } };

  const onSave = (dataUrl: string) => {
    const prefs = loadSavePrefs();
    if (prefs.remember && prefs.dir) {
      saveImageToHost(dataUrl, { dir: prefs.dir, name: autoName(), format: prefs.format, quality: prefs.quality })
        .then((path) => { markClean(); toast(`Saved → ${path}`, { tone: "success" }); })
        .catch((e) => toast(e instanceof Error ? e.message : "save failed", { tone: "error" }));
    } else {
      closeAfterSave.current = false;
      setPending(dataUrl);
    }
  };
  const onSaveAs = (dataUrl: string) => { closeAfterSave.current = false; setPending(dataUrl); };

  // The prompt's "Save" → render the canvas, open the dialog, close once saved.
  const saveThenClose = () => {
    setConfirmClose(false);
    const url = api.current?.exportPng() ?? null;
    if (!url) return forceClose();
    closeAfterSave.current = true;
    setPending(url);
  };

  const onDialogSaved = () => { markClean(); if (closeAfterSave.current) { closeAfterSave.current = false; forceClose(); } };

  const common = {
    compact,
    onSave,
    onSaveAs,
    onClose: () => winId && closeWindow(winId), // routes through the guard (prompts if dirty)
    onDirty: (d: boolean) => { dirty.current = d; },
    onReady: (a: EditorApi) => { api.current = a; },
    winId, // gates editor hotkeys on this OS window's focus state
  };
  const isDoc = p?.path && /\.(ie\.)?json$/i.test(p.path);

  return (
    <>
      <div ref={paneRef} className="h-full w-full">
        {isDoc ? (
          <ImageEditor
            {...common}
            projectSrc={rawUrl(p!.path!)}
            onSaveDoc={(doc) => {
              void fetch("/api/v1/fs/write", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ path: p!.path, content: JSON.stringify(doc) }),
              });
            }}
          />
        ) : (
          <ImageEditor {...common} initialImage={p?.path && (!p.kind || p.kind === "image") ? rawUrl(p.path) : undefined} />
        )}
      </div>

      <SaveImageDialog
        dataUrl={pending}
        open={pending !== null}
        onClose={() => { setPending(null); closeAfterSave.current = false; }}
        onSaved={onDialogSaved}
      />

      <FormDrawer open={confirmClose} onOpenChange={(o) => !o && setConfirmClose(false)} variant="alert" size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>Save changes before closing?</FormDrawer.Title>
          <FormDrawer.Description>Your image has unsaved edits. They’ll be lost if you don’t save.</FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>Cancel</Button>
          <Button variant="ghost" className="text-destructive" onClick={() => { setConfirmClose(false); forceClose(); }}>Don’t Save</Button>
          <Button onClick={saveThenClose}>Save</Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </>
  );
}

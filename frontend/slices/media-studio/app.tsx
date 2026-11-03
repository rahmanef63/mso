"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageEditor, type EditorApi } from "@/features/image-editor";
import { rawUrl } from "./lib/host";
import { closeWindow, setCloseGuard, toast, useContainer, useIsMobile, FormDrawer } from "@/features/appshell";
import type { AppProps } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { SaveImageDialog } from "./components/save-image-dialog";
import { autoName, loadSavePrefs, saveImageToHost } from "./lib/save-image";

// The OS "Image Editor" app — the portable image-editor slice + mso wiring:
// open host images / round-trip a saved doc, SAVE rendered images to a VPS folder,
// and guard window close on unsaved changes (Save / Don't Save / Cancel).
export default function MediaStudio({ payload, winId }: AppProps) {
  const p = payload as { path?: string; name?: string; kind?: string; src?: string } | undefined;
  const [pending, setPending] = useState<string | null>(null); // PNG awaiting the Save As dialog
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = useRef(false);
  const api = useRef<EditorApi | null>(null);
  const closeAfterSave = useRef(false);
  const [docStatus, setDocStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const docStatusRef = useRef(docStatus);
  useEffect(() => { docStatusRef.current = docStatus; }, [docStatus]);
  const latestDoc = useRef<Parameters<NonNullable<React.ComponentProps<typeof ImageEditor>["onSaveDoc"]>>[0] | null>(null);
  const docQueue = useRef<Promise<void>>(Promise.resolve());
  const saveDoc = useCallback((doc: NonNullable<typeof latestDoc.current>) => {
    latestDoc.current = doc;
    docStatusRef.current = "saving";
    setDocStatus("saving");
    docQueue.current = docQueue.current.catch(() => {}).then(async () => {
      const response = await fetch("/api/v1/fs/write", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p?.path, content: JSON.stringify(doc) }),
      });
      if (!response.ok) throw new Error("Save failed");
    }).then(() => { if (latestDoc.current === doc) { docStatusRef.current = "saved"; setDocStatus("saved"); } })
      .catch(() => { if (latestDoc.current === doc) { docStatusRef.current = "failed"; setDocStatus("failed"); } });
  }, [p?.path]);
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
      if (!dirty.current && docStatusRef.current !== "saving" && docStatusRef.current !== "failed") return true;
      setConfirmClose(true);
      return false;
    });
    return () => setCloseGuard(winId, null);
  }, [winId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current || docStatusRef.current === "saving" || docStatusRef.current === "failed") {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
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
    let url: string | null = null;
    try { url = api.current?.exportPng() ?? null; } catch { /* keep the window open */ }
    if (!url) { toast("Could not export image. Try again.", { tone: "error" }); return; }
    setConfirmClose(false);
    closeAfterSave.current = true;
    setPending(url);
  };

  const onDialogSaved = () => { markClean(); if (closeAfterSave.current) { closeAfterSave.current = false; if (docStatusRef.current === "saving" || docStatusRef.current === "failed") setConfirmClose(true); else forceClose(); } };

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
            onSaveDoc={saveDoc}
          />
        ) : (
          <ImageEditor {...common} initialImage={p?.src ?? (p?.path && (!p.kind || p.kind === "image") ? rawUrl(p.path) : undefined)} />
        )}
      </div>

      {isDoc && docStatus !== "idle" && <div role="status" className="absolute bottom-2 left-2 rounded bg-background p-2 text-sm">
        {docStatus === "saving" ? "Saving project..." : docStatus === "saved" ? "Project saved" : "Project save failed."}
        {docStatus === "failed" && <Button size="sm" onClick={() => latestDoc.current && saveDoc(latestDoc.current)}>Retry</Button>}
      </div>}
      <SaveImageDialog
        dataUrl={pending}
        open={pending !== null}
        onClose={() => { setPending(null); closeAfterSave.current = false; }}
        onSaved={onDialogSaved}
      />

      <FormDrawer open={confirmClose} onOpenChange={(o) => !o && setConfirmClose(false)} variant="alert" size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>Save changes before closing?</FormDrawer.Title>
          <FormDrawer.Description>{docStatus === "failed" ? "The project could not be saved. Retry or explicitly discard the unsaved project changes." : docStatus === "saving" ? "The project is still saving. Wait for it to finish or explicitly discard the unsaved project changes." : "Your image has unsaved edits. They’ll be lost if you don’t save."}</FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>Cancel</Button>
          <Button variant="ghost" className="text-destructive" onClick={() => { setConfirmClose(false); forceClose(); }}>Don’t Save</Button>
          {docStatus === "failed" ? <Button onClick={() => latestDoc.current && saveDoc(latestDoc.current)}>Retry project save</Button> : <Button disabled={docStatus === "saving"} onClick={saveThenClose}>Save image</Button>}
        </FormDrawer.Footer>
      </FormDrawer>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEditor } from "./lib/store";
import { loadAutosave, saveAutosave } from "./lib/project";
import { stageToDataURL } from "./lib/export";
import { ToolRail } from "./components/tool-rail";
import { MenuBar } from "./components/menu-bar";
import { ToolOptionsBar } from "./components/tool-options-bar";
import { SidePanel } from "./components/side-panel";
import { MobileShell } from "./components/mobile-shell";
import { useKeyboard } from "./hooks/use-keyboard";
import { useIsMobile } from "@/features/appshell";
import type { Doc } from "./lib/types";
import type { EditorApi } from "./lib/editor-api";

// Desktop layout: left tool rail · canvas · right dock (adjust top, layers bottom).
function DesktopShell({ stage, onSave, onSaveAs, onClose }: { stage: React.ReactNode; onSave?: (d: string) => void; onSaveAs?: (d: string) => void; onClose?: () => void }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <MenuBar onSave={onSave} onSaveAs={onSaveAs} onClose={onClose} />
      <ToolOptionsBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <div className="min-w-0 flex-1">{stage}</div>
        <SidePanel />
      </div>
    </div>
  );
}

// Autosave the editable project to localStorage (debounced); restore it on mount
// when the editor opened blank (no initialImage) so a reload doesn't lose work.
function useAutosave(autoRestore: boolean, saveDoc?: (doc: Doc) => void, ready = true) {
  const { doc, exportProject, loadProject } = useEditor();
  useEffect(() => {
    if (!autoRestore) return;
    const a = loadAutosave();
    if (a) loadProject(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // File-backed (opened from a path): debounce-save the Doc back to it — but
    // only once the initial load finished, so the blank starter never clobbers
    // the file. Otherwise fall back to the localStorage autosave.
    if (saveDoc) {
      if (!ready) return;
      const t = setTimeout(() => saveDoc(doc), 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => saveAutosave(exportProject()), 800);
    return () => clearTimeout(t);
  }, [doc, exportProject, saveDoc, ready]);
}

// Picks desktop vs mobile layout; both share ONE EditorStage element + provider.
export type ShellProps = {
  onSave?: (d: string) => void;
  onSaveAs?: (d: string) => void;
  onClose?: () => void;
  onDirty?: (dirty: boolean) => void;
  onReady?: (api: EditorApi) => void;
  autoRestore: boolean;
  saveDoc?: (doc: Doc) => void;
  ready?: boolean;
  compact?: boolean;
  winId?: string;
  stage: React.ReactNode;
};

export function Shell({ onSave, onSaveAs, onClose, onDirty, onReady, autoRestore, saveDoc, ready, compact, winId, stage }: ShellProps) {
  useKeyboard(winId);
  useAutosave(autoRestore, saveDoc, ready);
  const autoMobile = useIsMobile();
  const mobile = compact ?? autoMobile;
  const { version, canUndo, stageRef, rootRef, docView } = useEditor();
  // Dirty = history moved past the last save. Derived (no effect-driven
  // setState): loadProject/autosave don't push history so opening a file never
  // trips it; api.markSaved() pins savedVersion to the current version.
  const [savedVersion, setSavedVersion] = useState(0);
  const dirty = canUndo && version > savedVersion;
  const versionRef = useRef(version);
  useEffect(() => {
    versionRef.current = version;
  });
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    onReady?.({
      exportPng: () => { const s = stageRef.current; return s ? stageToDataURL(s, { format: "png", view: docView() }) : null; },
      markSaved: () => setSavedVersion(versionRef.current),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <TooltipProvider delayDuration={300}>
      {/* Focusable editor root: hotkey hooks gate on `rootRef.contains(activeElement)`
          so Delete/Space/tool keys only fire when THIS editor holds focus. Pulling
          focus here on pointer-down (unless already inside) keeps that check true
          while interacting with the canvas (which doesn't focus a DOM node). */}
      <div
        ref={rootRef}
        tabIndex={-1}
        className="h-full w-full outline-none"
        onPointerDownCapture={() => {
          const root = rootRef.current;
          if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
        }}
      >
        {mobile ? <MobileShell stage={stage} onSave={onSave} onSaveAs={onSaveAs} /> : <DesktopShell stage={stage} onSave={onSave} onSaveAs={onSaveAs} onClose={onClose} />}
      </div>
    </TooltipProvider>
  );
}

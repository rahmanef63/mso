"use client";

import { useRef, useState } from "react";
import {
  Upload,
  Scissors,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Save,
  FolderOpen,
  FileDown,
  HardDriveDownload,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilePicker, type FilePickerHandle } from "../lib/host";
import { useEditor } from "../lib/store";
import { createLayer } from "../lib/model";
import { fileToDataURL, loadImage } from "../lib/image-io";
import { removeImageBackground } from "../lib/bg-removal";
import { stageToDataURL } from "../lib/export";
import { downloadProject, parseProject, readBoundedProjectFile } from "../lib/project";

// Compact mobile command bar: a "⋯" menu folds the less-used file actions (open,
// remove BG, project open/save) so undo/redo, zoom, and Save stay one tap away.
export function TopBar({ onSave, onSaveAs }: { onSave?: (dataUrl: string) => void; onSaveAs?: (dataUrl: string) => void }) {
  const { doc, selected, addLayer, update, undo, redo, canUndo, canRedo, zoom, setZoom, stageRef, docView, exportProject, loadProject } = useEditor();
  const fileRef = useRef<FilePickerHandle>(null);
  const projRef = useRef<FilePickerHandle>(null);
  const [busy, setBusy] = useState(false);

  async function openProject(file: File) {
    const p = parseProject(await readBoundedProjectFile(file));
    if (p) loadProject(p);
  }

  async function openFile(file: File) {
    // Persist a data URL, not a blob: URL — the latter is revoked on unload and
    // would serialize dead into autosave/Save. Object URL is transient (measure
    // only) and revoked immediately.
    const objUrl = URL.createObjectURL(file);
    const img = await loadImage(objUrl).finally(() => URL.revokeObjectURL(objUrl));
    const src = await fileToDataURL(file);
    const max = Math.min(doc.width, doc.height) * 0.9;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * k);
    const h = Math.round(img.height * k);
    addLayer(createLayer("image", { name: file.name, src, t: { x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2), width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 } }));
  }

  async function removeBg() {
    if (!selected || selected.kind !== "image" || !selected.src) return;
    setBusy(true);
    try {
      const out = await removeImageBackground(selected.src);
      update(selected.id, { src: out, name: `${selected.name} (cutout)` });
    } finally {
      setBusy(false);
    }
  }

  const canCut = selected?.kind === "image" && !!selected.src;
  const z = (d: number) => setZoom(Math.min(5, Math.max(0.1, Math.round((zoom + d) * 100) / 100)));

  return (
    // overflow-x-auto + shrink-0 buttons: at very narrow widths (360px) the row
    // scrolls instead of squeezing the 36px icon buttons below tap-target size.
    <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2 [scrollbar-width:none]">
      <FilePicker ref={fileRef} accept="image/*" onFiles={(files) => { const f = files[0]; if (f) void openFile(f); }} />
      <FilePicker ref={projRef} accept=".json,application/json" onFiles={(files) => { const f = files[0]; if (f) void openProject(f); }} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="File menu" className="shrink-0 [@media(pointer:coarse)]:size-[44px]">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onSelect={() => fileRef.current?.open()}><Upload className="size-4" /> Open image…</DropdownMenuItem>
          <DropdownMenuItem disabled={!canCut} onSelect={() => void removeBg()}><Scissors className="size-4" /> Remove background</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => projRef.current?.open()}><FolderOpen className="size-4" /> Open project…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadProject(exportProject())}><FileDown className="size-4" /> Save project</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <Button variant="ghost" size="icon" className="shrink-0 [@media(pointer:coarse)]:size-[44px]" disabled={!canUndo} onClick={undo} aria-label="Undo"><Undo2 className="size-4" /></Button>
      <Button variant="ghost" size="icon" className="shrink-0 [@media(pointer:coarse)]:size-[44px]" disabled={!canRedo} onClick={redo} aria-label="Redo"><Redo2 className="size-4" /></Button>
      <Separator orientation="vertical" className="mx-0.5 h-6" />
      <Button variant="ghost" size="icon" className="shrink-0 [@media(pointer:coarse)]:size-[44px]" onClick={() => z(-0.1)} aria-label="Zoom out"><ZoomOut className="size-4" /></Button>
      <span className="w-11 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
      <Button variant="ghost" size="icon" className="shrink-0 [@media(pointer:coarse)]:size-[44px]" onClick={() => z(0.1)} aria-label="Zoom in"><ZoomIn className="size-4" /></Button>

      <div className="flex-1" />
      {onSaveAs && (
        <Button variant="ghost" size="icon" className="shrink-0 [@media(pointer:coarse)]:size-[44px]" onClick={() => { const s = stageRef.current; if (s) onSaveAs(stageToDataURL(s, { format: "png", view: docView() })); }} aria-label="Save As">
          <HardDriveDownload className="size-4" />
        </Button>
      )}
      {onSave && (
        <Button size="sm" className="shrink-0 [@media(pointer:coarse)]:min-h-[44px]" onClick={() => { const s = stageRef.current; if (s) onSave(stageToDataURL(s, { format: "png", view: docView() })); }}>
          <Save className="size-4" /> Save
        </Button>
      )}
    </div>
  );
}

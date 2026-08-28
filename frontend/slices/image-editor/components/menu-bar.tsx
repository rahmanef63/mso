"use client";

import { useRef, useState, type ReactNode } from "react";
import { Undo2, Redo2, Save } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FilePicker, type FilePickerHandle } from "../lib/host";
import { useEditor } from "../lib/store";
import { ASPECT_PRESETS, createLayer } from "../lib/model";
import { fileToDataURL, loadImage } from "../lib/image-io";
import { removeImageBackground } from "../lib/bg-removal";
import { exportStage, stageToDataURL } from "../lib/export";
import { downloadProject, parseProject, readBoundedProjectFile } from "../lib/project";
import type { LayerKind } from "../lib/types";

// Photoshop-style menu bar (desktop): File · Edit · Image · Layer · Select · View,
// plus a quick action cluster on the right. Self-contained — drives the editor
// store; Save/Save As/Close are injected so the slice stays shell-agnostic.
export function MenuBar({
  onSave,
  onSaveAs,
  onClose,
}: {
  onSave?: (dataUrl: string) => void;
  onSaveAs?: (dataUrl: string) => void;
  onClose?: () => void;
}) {
  const ed = useEditor();
  const {
    doc, selected, selectedId, fg, stageRef, docView,
    addLayer, duplicateLayer, removeLayer, raise, lower, addMask, removeMask, update,
    undo, redo, canUndo, canRedo, zoom, setZoom, setDocSize, setTool, select,
    exportProject, loadProject,
  } = ed;
  const fileRef = useRef<FilePickerHandle>(null);
  const projRef = useRef<FilePickerHandle>(null);
  const [busy, setBusy] = useState(false);

  const png = () => { const s = stageRef.current; return s ? stageToDataURL(s, { format: "png", view: docView() }) : null; };
  const z = (d: number) => setZoom(Math.min(5, Math.max(0.1, Math.round((zoom + d) * 100) / 100)));
  const add = (kind: LayerKind) =>
    addLayer(createLayer(kind, kind === "text" ? { fill: fg } : kind === "shape" ? { fillColor: fg } : {}));

  async function openImage(file: File) {
    // Read the file to a persistable data URL (NOT a blob: URL, which dies on
    // reload and would serialize dead into autosave/Save). Use a transient object
    // URL only to measure the image, then revoke it.
    const objUrl = URL.createObjectURL(file);
    const img = await loadImage(objUrl).finally(() => URL.revokeObjectURL(objUrl));
    const src = await fileToDataURL(file);
    const k = Math.min(1, (Math.min(doc.width, doc.height) * 0.9) / Math.max(img.width, img.height));
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    addLayer(createLayer("image", { name: file.name, src, t: { x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2), width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1 } }));
  }
  async function openProject(file: File) { const p = parseProject(await readBoundedProjectFile(file)); if (p) loadProject(p); }
  async function removeBg() {
    if (!selected || selected.kind !== "image" || !selected.src) return;
    setBusy(true);
    try { update(selected.id, { src: await removeImageBackground(selected.src), name: `${selected.name} (cutout)` }); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-card px-2">
      <span className="px-1.5 text-xs font-semibold">Studio</span>
      <FilePicker ref={fileRef} accept="image/*" onFiles={(files) => { const f = files[0]; if (f) void openImage(f); }} />
      <FilePicker ref={projRef} accept=".json,application/json" onFiles={(files) => { const f = files[0]; if (f) void openProject(f); }} />

      <Menu label="File">
        <Item onSelect={() => fileRef.current?.open()}>Open Image…</Item>
        <Item onSelect={() => projRef.current?.open()}>Open Project…</Item>
        <DropdownMenuSeparator />
        {onSave && <Item onSelect={() => { const u = png(); if (u) onSave(u); }} shortcut="⌘S">Save</Item>}
        {onSaveAs && <Item onSelect={() => { const u = png(); if (u) onSaveAs(u); }} shortcut="⇧⌘S">Save As…</Item>}
        <Item onSelect={() => downloadProject(exportProject())}>Save Project (.json)</Item>
        <Item onSelect={() => { const s = stageRef.current; if (s) exportStage(s, { format: "png", name: "export", view: docView() }); }}>Export PNG</Item>
        {onClose && <><DropdownMenuSeparator /><Item onSelect={onClose} shortcut="⌘W">Close</Item></>}
      </Menu>

      <Menu label="Edit">
        <Item onSelect={undo} disabled={!canUndo} shortcut="⌘Z">Undo</Item>
        <Item onSelect={redo} disabled={!canRedo} shortcut="⇧⌘Z">Redo</Item>
      </Menu>

      <Menu label="Image">
        <Item onSelect={() => void removeBg()} disabled={selected?.kind !== "image" || busy}>Remove Background</Item>
        <Item onSelect={() => setTool("crop")}>Crop</Item>
        <DropdownMenuSeparator />
        {ASPECT_PRESETS.map((p) => <Item key={p.label} onSelect={() => setDocSize(p.w, p.h)}>{p.label}</Item>)}
      </Menu>

      <Menu label="Layer">
        <Item onSelect={() => add("paint")}>New Pixel Layer</Item>
        <Item onSelect={() => add("text")}>New Text</Item>
        <Item onSelect={() => add("shape")}>New Shape</Item>
        <Item onSelect={() => add("adjustment")}>New Adjustment</Item>
        <DropdownMenuSeparator />
        <Item disabled={!selectedId} onSelect={() => selectedId && duplicateLayer(selectedId)}>Duplicate</Item>
        <Item disabled={!selectedId} onSelect={() => selectedId && removeLayer(selectedId)}>Delete</Item>
        <DropdownMenuSeparator />
        <Item disabled={!selectedId} onSelect={() => selectedId && raise(selectedId)}>Bring Forward</Item>
        <Item disabled={!selectedId} onSelect={() => selectedId && lower(selectedId)}>Send Backward</Item>
        <DropdownMenuSeparator />
        {selected?.mask
          ? <Item onSelect={() => selected && removeMask(selected.id)}>Remove Mask</Item>
          : <Item disabled={!selected} onSelect={() => selected && addMask(selected.id)}>Add Mask</Item>}
      </Menu>

      <Menu label="Select">
        <Item onSelect={() => select(null)}>Deselect</Item>
        <DropdownMenuSeparator />
        <Item onSelect={() => setTool("move")}>Move Tool</Item>
        <Item onSelect={() => setTool("brush")}>Brush Tool</Item>
        <Item onSelect={() => setTool("eraser")}>Eraser Tool</Item>
      </Menu>

      <Menu label="View">
        <Item onSelect={() => z(0.1)} shortcut="⌘+">Zoom In</Item>
        <Item onSelect={() => z(-0.1)} shortcut="⌘-">Zoom Out</Item>
        <Item onSelect={() => setZoom(1)} shortcut="⌘1">Actual Size (100%)</Item>
      </Menu>

      <div className="flex-1" />
      <Button variant="ghost" size="icon" className="size-7" disabled={!canUndo} onClick={undo} aria-label="Undo"><Undo2 className="size-4" /></Button>
      <Button variant="ghost" size="icon" className="size-7" disabled={!canRedo} onClick={redo} aria-label="Redo"><Redo2 className="size-4" /></Button>
      <Separator orientation="vertical" className="mx-1 h-6" />
      {onSave && <Button size="sm" onClick={() => { const u = png(); if (u) onSave(u); }}><Save className="size-4" /> Save</Button>}
    </div>
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal">{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({ children, onSelect, disabled, shortcut }: { children: ReactNode; onSelect: () => void; disabled?: boolean; shortcut?: string }) {
  return (
    <DropdownMenuItem className="gap-2 text-xs" disabled={disabled} onSelect={onSelect}>
      {children}
      {shortcut && <span className="ml-auto text-[10px] tracking-wide text-muted-foreground">{shortcut}</span>}
    </DropdownMenuItem>
  );
}

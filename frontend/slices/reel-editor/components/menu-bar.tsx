"use client";

import { useRef, useState } from "react";
import { Clapperboard, Check, Image as ImageIcon, Film, Music, HardDrive } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { toast, rawUrl, FilePicker, type FilePickerHandle } from "../lib/host";
import { cn } from "@/lib/utils";
import { RATIOS } from "../lib/composition";
import { LAYOUTS } from "../lib/layout";
import { SAMPLES, useImport } from "../lib/use-import";
import { type Composition, type MediaRef, type TrackKind } from "../lib/mock-timeline";
import { type PanelMode } from "./toolbar";
import { FileBrowser } from "./file-browser";

type MenuBarProps = {
  comp: Composition;
  mode: PanelMode;
  zoom: number;
  hasSel: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAddMedia: (m: MediaRef, name: string) => void;
  onRatio: (w: number, h: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onZoom: (z: number) => void;
  onTogglePanel: () => void;
  onMode: (m: PanelMode) => void;
  onAddTrack: (kind: TrackKind) => void;
  onRender: () => void;
  layoutId: string;
  onLayout: (id: string) => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
  savedAt: number | null;
};

// A single top-level menu (File/Edit/…) rendered as a flat dropdown trigger.
function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      {/* Coarse pointers: ≥44px tall tap target; desktop pointer keeps the slim 24px row. */}
      <DropdownMenuTrigger className="inline-flex items-center rounded px-2 py-0.5 text-[13px] text-foreground/80 outline-none hover:bg-secondary data-[state=open]:bg-secondary data-[state=open]:text-foreground [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-3">
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The app menu bar: real File/Edit/View/Clip/Help menus wired to every action,
// plus a quick Editor/AI mode toggle on the right. Owns the hidden file inputs
// + VPS browser the File menu's import items drive.
export function MenuBar(p: MenuBarProps) {
  const imgRef = useRef<FilePickerHandle>(null);
  const vidRef = useRef<FilePickerHandle>(null);
  const audRef = useRef<FilePickerHandle>(null);
  const [browse, setBrowse] = useState(false);
  const { add } = useImport(p.onAddMedia);
  const onFiles = (type: "image" | "video" | "audio") => (files: File[]) =>
    files[0] && void add(URL.createObjectURL(files[0]), type, files[0].name);

  const shortcuts = "Space play · S split · ⌘Z undo · ⌘⇧Z redo · ⌘D duplicate · ⌫ delete";

  return (
    <header className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilePicker ref={imgRef} accept="image/*" onFiles={onFiles("image")} />
      <FilePicker ref={vidRef} accept="video/*" onFiles={onFiles("video")} />
      <FilePicker ref={audRef} accept="audio/*" onFiles={onFiles("audio")} />

      <Clapperboard className="mx-1 size-4 shrink-0 text-primary" />
      {/* Brand label yields first on a narrow pane (@container on the app root). */}
      <strong className="mr-1 hidden text-[13px] @md:inline">Video Editor</strong>

      <Menu label="File">
        <DropdownMenuItem onSelect={p.onNewProject}>New project</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={() => imgRef.current?.open()}>
          <ImageIcon className="size-4" /> Import image…
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={() => vidRef.current?.open()}>
          <Film className="size-4" /> Import video…
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={() => audRef.current?.open()}>
          <Music className="size-4" /> Import audio…
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={() => setBrowse(true)}>
          <HardDrive className="size-4" /> Browse VPS…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {SAMPLES.map((s) => (
          <DropdownMenuItem key={s.url} onSelect={() => void add(s.url, s.type, s.label)}>
            {s.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={p.onRender}>
          Export video<DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={p.onOpenSettings}>Settings…</DropdownMenuItem>
      </Menu>

      <Menu label="Edit">
        <DropdownMenuItem disabled={!p.canUndo} onSelect={p.onUndo}>
          Undo<DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!p.canRedo} onSelect={p.onRedo}>
          Redo<DropdownMenuShortcut>⌘⇧Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!p.hasSel} onSelect={p.onSplit}>
          Split at playhead<DropdownMenuShortcut>S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!p.hasSel} onSelect={p.onDuplicate}>
          Duplicate clip<DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!p.hasSel} onSelect={p.onDelete}>
          Delete clip<DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </Menu>

      <Menu label="View">
        <DropdownMenuItem onSelect={() => p.onZoom(Math.min(12, p.zoom * 1.5))}>
          Zoom in<DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => p.onZoom(Math.max(0.5, p.zoom / 1.5))}>
          Zoom out<DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => p.onZoom(3.2)}>Reset zoom</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={p.onTogglePanel}>Toggle properties</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => p.onMode("editor")}>Editor panel</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => p.onMode("ai")}>AI assistant</DropdownMenuItem>
        <DropdownMenuSeparator />
        {LAYOUTS.map((l) => (
          <DropdownMenuItem
            key={l.id}
            className={cn("gap-2", l.id === p.layoutId && "font-semibold text-primary")}
            onSelect={() => p.onLayout(l.id)}
          >
            <Check className={cn("size-3.5", l.id !== p.layoutId && "opacity-0")} />
            {l.label}
          </DropdownMenuItem>
        ))}
      </Menu>

      <Menu label="Clip">
        {RATIOS.map((r) => {
          const on = p.comp.w === r.w && p.comp.h === r.h;
          return (
            <DropdownMenuItem key={r.label} className={cn("gap-2", on && "font-semibold text-primary")} onSelect={() => p.onRatio(r.w, r.h)}>
              <Check className={cn("size-3.5", !on && "opacity-0")} />
              {r.label} <span className="text-muted-foreground">{r.dims}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => p.onAddTrack("video")}>Add video track</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => p.onAddTrack("audio")}>Add audio track</DropdownMenuItem>
      </Menu>

      <Menu label="Help">
        <DropdownMenuItem onSelect={() => toast(shortcuts)}>Keyboard shortcuts</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toast("Video Editor — render reels on your VPS")}>
          About Video Editor
        </DropdownMenuItem>
      </Menu>

      <div className="ml-auto flex items-center gap-2">
        {p.savedAt != null && (
          <span className="hidden text-[10px] text-muted-foreground @md:inline" title="Draft auto-saved in this browser">
            ✓ Saved {new Date(p.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Segmented
          value={p.mode}
          onChange={(m) => p.onMode(m as PanelMode)}
          options={[
            { value: "editor", label: "Editor" },
            { value: "ai", label: "AI" },
          ]}
        />
      </div>

      <FileBrowser open={browse} onOpenChange={setBrowse} onPick={(path, name, type) => void add(rawUrl(path), type, name)} />
    </header>
  );
}

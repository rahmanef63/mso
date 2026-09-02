"use client";

import { useRef, type DragEvent, type MouseEvent, type ReactNode } from "react";
import type { FsEntry } from "../lib/host";
import { FileItem } from "./file-item";
import { joinPath } from "../lib/format";
import type { ViewMode } from "../lib/types";
import type { UseDnd } from "../hooks/use-dnd";
import { useViewportWindow } from "@/features/appshell";

// Past this length the list view DOM-virtualizes (only the visible window +
// overscan mount). Audit AUDIT-2026-06-11 §5: list is the one view that needs
// it; grid stays as-is (image thumbs already lazy-load).
const VIRTUALIZE_THRESHOLD = 200;
// Matches `px-3 py-1.5 text-xs` (~28px). Constant — list rows never wrap, so the
// height is uniform. If the row class changes, bump this in tandem.
const LIST_ROW_HEIGHT = 28;

export function FileView({
  ios,
  entries,
  view,
  dir,
  selected,
  cutNames,
  renaming,
  dnd,
  onItemClick,
  onOpen,
  onContext,
  onRename,
  onRenameCancel,
}: {
  ios: boolean;
  entries: FsEntry[];
  view: ViewMode;
  dir: string;
  selected: Set<string>;
  cutNames: Set<string>;
  renaming: string | null;
  dnd: UseDnd;
  onItemClick: (e: MouseEvent, entry: FsEntry, index: number) => void;
  onOpen: (entry: FsEntry) => void;
  onContext: (e: MouseEvent, entry: FsEntry) => void;
  onRename: (from: string, to: string) => void;
  onRenameCancel: () => void;
}) {
  // Background drop = upload into the current dir (folders bubble-stop their own).
  const bgDrop = {
    onDragOver: (e: DragEvent) => dnd.onDragOver(e, dir),
    onDragLeave: () => dnd.onDragLeave(dir),
    onDrop: (e: DragEvent) => dnd.onDrop(e, dir),
  };
  const bgRing = dnd.dropTarget === dir ? "rounded-lg ring-2 ring-inset ring-primary/60" : "";

  if (entries.length === 0) {
    return (
      <div
        {...bgDrop}
        className={`flex h-full items-center justify-center p-8 text-center text-muted-foreground ${ios ? "text-[15px]" : "text-xs"} ${bgRing}`}
      >
        {ios ? "No Items" : "Drop files or folders here to upload"}
      </div>
    );
  }

  // Build a single row given its real (entries-array) index — virtualization
  // never lies about position, so keyboard nav + shift-range selection keep
  // working when the active item is offscreen.
  const renderRow = (entry: FsEntry, i: number) => {
    const dest = entry.kind === "dir" ? joinPath(dir, entry.name) : "";
    return (
      <FileItem
        key={entry.name}
        entry={entry}
        view={view}
        dirPath={dir}
        selected={selected.has(entry.name)}
        cut={cutNames.has(entry.name)}
        renaming={renaming === entry.name}
        dropActive={!!dest && dnd.dropTarget === dest}
        onClick={(e) => onItemClick(e, entry, i)}
        onOpen={() => onOpen(entry)}
        onContext={(e) => onContext(e, entry)}
        onRename={(to) => onRename(entry.name, to)}
        onRenameCancel={onRenameCancel}
        onDragStart={(e) => dnd.onDragStart(e, entry)}
        onDragOver={(e) => dnd.onDragOver(e, dest)}
        onDragLeave={() => dnd.onDragLeave(dest)}
        onDrop={(e) => dnd.onDrop(e, dest)}
      />
    );
  };

  if (view === "grid") {
    // Grid stays non-virtualized — thumbs are already lazy-loaded and counts
    // typical for media folders stay below the cost threshold.
    return (
      <div
        {...bgDrop}
        className={`@container grid min-h-full grid-cols-[repeat(auto-fill,minmax(96px,1fr))] content-start gap-2 p-3 @max-[430px]:grid-cols-2 ${bgRing}`}
      >
        {entries.map((entry, i) => renderRow(entry, i))}
      </div>
    );
  }

  return (
    <ListBody
      bgDrop={bgDrop}
      bgRing={bgRing}
      entries={entries}
      renderRow={renderRow}
    />
  );
}

// Extracted so we can `useRef`/`useViewportWindow` without conditionally
// running hooks in the parent (early return for empty state above).
function ListBody({
  bgDrop,
  bgRing,
  entries,
  renderRow,
}: {
  bgDrop: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
  bgRing: string;
  entries: FsEntry[];
  renderRow: (entry: FsEntry, i: number) => ReactNode;
}) {
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const enabled = entries.length > VIRTUALIZE_THRESHOLD;
  const win = useViewportWindow(entries, {
    rowHeight: LIST_ROW_HEIGHT,
    overscan: 5,
    containerRef: spacerRef,
  });

  const header = (
    <div className="grid grid-cols-[1fr_92px_96px] gap-2 border-b border-border px-3 pb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase @max-[430px]:grid-cols-[1fr_72px]">
      <span>Name</span>
      <span>Size</span>
      <span className="@max-[430px]:hidden">Kind</span>
    </div>
  );

  if (!enabled) {
    // Small folders: cheap path, plain stacked rows — no positioning math, no
    // chance of layout drift from the virtualization spacer.
    return (
      <div {...bgDrop} className={`min-h-full py-1 ${bgRing}`}>
        {header}
        {entries.map((entry, i) => renderRow(entry, i))}
      </div>
    );
  }

  const slice = entries.slice(win.start, win.end);
  return (
    <div {...bgDrop} className={`min-h-full py-1 ${bgRing}`}>
      {header}
      <div ref={spacerRef} style={{ height: win.totalHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: win.offsetTop, left: 0, right: 0 }}>
          {slice.map((entry, j) => renderRow(entry, win.start + j))}
        </div>
      </div>
    </div>
  );
}

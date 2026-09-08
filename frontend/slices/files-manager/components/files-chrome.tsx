"use client";

import { useActiveShell } from "@/features/appshell";
import { Search, X } from "lucide-react";
import { FilesToolbar } from "./files-toolbar";
import { UploadBar } from "./upload-bar";
import { FileDetails } from "./file-details";
import type { useFiles } from "../hooks/use-files";
import type { useFileCommands } from "../hooks/use-file-commands";
import type { useDnd } from "../hooks/use-dnd";
import type { FsEntry } from "../lib/host";
import type { SortKey, ViewMode } from "../lib/types";

type Fs = ReturnType<typeof useFiles>;
type Cmd = ReturnType<typeof useFileCommands>;
type Dnd = ReturnType<typeof useDnd>;

// Toolbar header: nav + view/sort + new/upload, then UploadBar, then error.
// Extracted from app.tsx purely to keep that file ≤200 LOC; no behavior change.
export function FilesHeader({
  ios, fs, cmd, dnd, view, sort, setView, setSort, query, setQuery, searchOpen, onToggleSearch,
  openPicker, openFolderPicker, openSidebar, clearSel, selectedCount, onDownload,
}: {
  ios: boolean;
  fs: Fs; cmd: Cmd; dnd: Dnd;
  view: ViewMode; sort: SortKey;
  setView: (v: ViewMode) => void;
  setSort: (s: SortKey) => void;
  query: string;
  setQuery: (v: string) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  openPicker: () => void;
  openFolderPicker: () => void;
  openSidebar: () => void;
  clearSel: () => void;
  selectedCount: number;
  onDownload: () => void;
}) {
  return (
    <>
      <FilesToolbar
        ios={ios}
        path={fs.path}
        query={query}
        onQuery={setQuery}
        onRefresh={fs.refresh}
        canBack={fs.canBack}
        canForward={fs.canForward}
        view={view}
        sort={sort}
        hasClipboard={!!fs.clip}
        onBack={() => { fs.goBack(); clearSel(); }}
        onForward={() => { fs.goForward(); clearSel(); }}
        onNavigate={cmd.go}
        onView={setView}
        onSort={setSort}
        onNewFolder={cmd.newFolder}
        onUpload={openPicker}
        onUploadFolder={openFolderPicker}
        onPaste={fs.paste}
        onOpenSidebar={openSidebar}
        selectedCount={selectedCount}
        onDownload={onDownload}
        dropTarget={dnd.dropTarget}
        onCrumbDragOver={dnd.onDragOver}
        onCrumbDragLeave={dnd.onDragLeave}
        onCrumbDrop={dnd.onDrop}
        searchOpen={searchOpen}
        onToggleSearch={onToggleSearch}
      />
      {ios && searchOpen && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Isolate the search field from the list's ⌘-shortcuts + type-ahead.
              e.stopPropagation();
              if (e.key === "Escape") { setQuery(""); onToggleSearch(); }
            }}
            placeholder="Search this folder"
            aria-label="Search this folder"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => { setQuery(""); onToggleSearch(); }}
            aria-label="Close search"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <UploadBar />
      {fs.error && (
        <div className="border-t border-destructive/30 bg-destructive/10 px-3 py-1 text-[11px] text-destructive">
          {fs.error}
        </div>
      )}
    </>
  );
}

// Footer: optional FileDetails + counts/clipboard hint.
export function FilesFooter({
  fs, isMobile, selectedEntry, orderedLen, selectedCount,
}: {
  fs: Fs;
  isMobile: boolean;
  selectedEntry: FsEntry | null;
  orderedLen: number | null;
  selectedCount: number;
}) {
  const { id: shell } = useActiveShell();
  return (
    <>
      {!isMobile && selectedEntry && <FileDetails entry={selectedEntry} dir={fs.path} />}
      <div className="flex items-center gap-3 px-3 pt-1.5 text-[11px] text-muted-foreground [padding-bottom:calc(0.375rem+var(--sai-bottom))]">
        <span>{orderedLen !== null ? `${orderedLen} items` : "—"}</span>
        {selectedCount > 0 && <span>{selectedCount} selected</span>}
        {fs.clip && (
          <span className="ml-auto">
            {fs.clip.names.length} {fs.clip.mode === "cut" ? "cut" : "copied"} — {shell === "windows" ? "Ctrl" : "⌘"}V to paste
          </span>
        )}
      </div>
    </>
  );
}

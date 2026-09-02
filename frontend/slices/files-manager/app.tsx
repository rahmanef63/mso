"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppFrame, AppSidebar, useActiveShell, useResponsive, type AppProps } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropOverlay } from "./components/drop-overlay";
import { FilesSidebar } from "./components/files-sidebar";
import { FileView } from "./components/file-view";
import { FileContextMenu } from "./components/file-context-menu";
import { ZipDialog } from "./components/zip-dialog";
import { UploadInput } from "./components/upload-input";
import { FilesHeader, FilesFooter } from "./components/files-chrome";
import { useFiles } from "./hooks/use-files";
import { useFilesInspector } from "./hooks/use-files-inspector";
import { useFileSelection } from "./hooks/use-file-selection";
import { useFileCommands } from "./hooks/use-file-commands";
import { useDnd } from "./hooks/use-dnd";
import { useWindowDrop } from "./hooks/use-window-drop";
import { useTypeahead } from "./hooks/use-typeahead";
import { sortEntries, type SortKey, type ViewMode } from "./lib/types";
import { canPreview } from "./lib/icons";

// Optional `{ path }` payload (e.g. from Spotlight) opens the manager there.
function initialPath(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "path" in payload) {
    const p = (payload as { path?: unknown }).path;
    if (typeof p === "string" && p) return p;
  }
  return undefined;
}

export default function FilesManager({ payload }: AppProps) {
  const fs = useFiles(initialPath(payload));
  // Per-shell default view (same explorer, shell-idiomatic first impression):
  // macOS Finder + iOS Files open in the icon grid, Windows Explorer in the
  // details list. The user can still toggle; this only seeds the initial mode.
  const { id: shellId } = useActiveShell();
  const [view, setView] = useState<ViewMode>(shellId === "windows" ? "list" : "grid");
  const [sort, setSort] = useState<SortKey>("name");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Mobile pulls the FileDetails strip out of the footer (path + size + copy
  // are recoverable from the row's context menu / long-press); the saved
  // ~52px back-to viewable rows is a bigger win than a dense info strip on a
  // 380px-wide window.
  const { isMobile } = useResponsive();

  // Sort, then filter by the search query. `visible` is the array actually
  // rendered — selection, the row index that drives shift-range, and the
  // type-ahead are all keyed to it, so they track what's on screen (not the raw
  // fs order, which sorting/filtering diverge from).
  const ordered = useMemo(
    () => (fs.entries ? sortEntries(fs.entries, sort) : null),
    [fs.entries, sort],
  );
  const visible = useMemo(() => {
    if (!ordered) return null;
    const q = query.trim().toLowerCase();
    return q ? ordered.filter((e) => e.name.toLowerCase().includes(q)) : ordered;
  }, [ordered, query]);

  const sel = useFileSelection(visible);
  const cmd = useFileCommands(fs, sel);
  const dnd = useDnd(sel.selected, sel.selectOne, fs.move, fs.upload);
  // Finder-style type-ahead: bare printable keys jump the selection to the first
  // visible entry whose name starts with what you typed (composed into the root
  // onKeyDown below, next to cmd.onKey).
  const onTypeahead = useTypeahead(visible ?? [], sel.selectOne);
  const uploadRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const cutNames =
    fs.clip?.mode === "cut" && fs.clip.from === fs.path ? new Set(fs.clip.names) : new Set<string>();
  const selectedEntry =
    sel.selected.size === 1
      ? (fs.entries?.find((e) => sel.selected.has(e.name)) ?? null)
      : null;
  const openPicker = () => uploadRef.current?.click();
  const openFolderPicker = () => folderRef.current?.click();

  // Window-wide drop zone (toolbar/sidebar/padding drops included) + the
  // shell AI Inspector publication — both extracted to sibling hooks.
  const winDrop = useWindowDrop(dnd, fs.path);
  useFilesInspector(fs, sel.selected.size, cmd.emptyTrash);

  return (
    <div
      className="relative flex h-full outline-none"
      tabIndex={0}
      onKeyDown={(e) => { cmd.onKey(e); onTypeahead(e); }}
      onDragOver={winDrop.onDragOver}
      onDragLeave={winDrop.onDragLeave}
      onDrop={winDrop.onDrop}
      onDropCapture={winDrop.onDropCapture}
    >
      {winDrop.dragActive && <DropOverlay />}
      {/* Left nav: inline rail on wide windows, left Sheet on narrow/mobile. */}
      <AppSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        title="Files"
        description="Browse favorites, the file tree, and storage."
      >
        <FilesSidebar
          path={fs.path}
          roots={fs.roots}
          usage={fs.usage}
          dropTarget={dnd.dropTarget}
          onNavigate={(p) => { cmd.go(p); setSidebarOpen(false); }}
          onOpenFile={(p) => { cmd.openPath(p); setSidebarOpen(false); }}
          onEmptyTrash={cmd.emptyTrash}
          onDragOver={dnd.onDragOver}
          onDragLeave={dnd.onDragLeave}
          onDrop={dnd.onDrop}
        />
      </AppSidebar>
      <AppFrame
        className="min-w-0 flex-1"
        safeArea={false}
        toolbar={
          <FilesHeader
            ios={shellId === "ios"}
            fs={fs} cmd={cmd} dnd={dnd}
            view={view} sort={sort}
            setView={setView} setSort={setSort}
            query={query} setQuery={setQuery}
            searchOpen={searchOpen} onToggleSearch={() => setSearchOpen((o) => !o)}
            openPicker={openPicker} openFolderPicker={openFolderPicker}
            openSidebar={() => setSidebarOpen(true)}
            clearSel={sel.clear}
            selectedCount={sel.selected.size}
            onDownload={() => cmd.download([...sel.selected])}
          />
        }
        footer={
          <FilesFooter
            fs={fs} isMobile={isMobile}
            selectedEntry={selectedEntry}
            orderedLen={visible ? visible.length : null}
            selectedCount={sel.selected.size}
          />
        }
      >
        <ScrollArea
          className="h-full"
          onClick={() => sel.clear()}
          onContextMenu={(e) => cmd.onContext(e, null)}
        >
          {fs.loadFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-xs text-muted-foreground">
              <span>Couldn’t read this folder.</span>
              <Button variant="outline" size="sm" onClick={fs.refresh}>
                Retry
              </Button>
            </div>
          ) : visible === null ? (
            <div className="flex h-full items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : (
            <FileView
              ios={shellId === "ios"}
              entries={visible}
              view={view}
              dir={fs.path}
              selected={sel.selected}
              cutNames={cutNames}
              renaming={cmd.renaming}
              dnd={dnd}
              onItemClick={sel.onItemClick}
              onOpen={cmd.open}
              onContext={cmd.onContext}
              onRename={cmd.doRename}
              onRenameCancel={() => cmd.setRenaming(null)}
            />
          )}
        </ScrollArea>
      </AppFrame>

      {cmd.ctx && (
        <FileContextMenu
          ctx={cmd.ctx}
          hasClipboard={!!fs.clip}
          inTrash={cmd.inTrash}
          onClose={() => cmd.setCtx(null)}
          onOpen={() => cmd.ctx?.entry && cmd.open(cmd.ctx.entry)}
          canPreview={!!cmd.ctx?.entry && canPreview(cmd.ctx.entry)}
          onPreview={() => cmd.ctx?.entry && cmd.preview(cmd.ctx.entry)}
          onOpenClaudeCode={() => cmd.ctx?.entry && cmd.openInClaudeCode(cmd.ctx.entry)}
          onRename={() => cmd.ctx?.entry && cmd.setRenaming(cmd.ctx.entry.name)}
          onNewFolder={cmd.newFolder}
          onUpload={openPicker}
          onUploadFolder={openFolderPicker}
          onCut={() => cmd.cut(cmd.targets())}
          onCopy={() => cmd.copy(cmd.targets())}
          onPaste={fs.paste}
          downloadCount={cmd.targets().length}
          onDownload={() => cmd.download(cmd.targets())}
          onDelete={() => cmd.del(cmd.targets())}
        />
      )}
      <ZipDialog
        open={!!cmd.zipPrompt}
        count={cmd.zipPrompt?.names.length ?? 0}
        filename={cmd.zipPrompt?.filename ?? ""}
        onClose={() => cmd.setZipPrompt(null)}
        onConfirm={cmd.confirmZip}
      />
      <UploadInput ref={uploadRef} onFiles={fs.upload} />
      <UploadInput ref={folderRef} onFiles={fs.upload} directory />
    </div>
  );
}

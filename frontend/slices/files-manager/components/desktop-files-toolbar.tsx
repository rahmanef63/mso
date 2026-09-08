"use client";

import { ArrowLeft, ArrowRight, ArrowUp, RotateCw, PanelLeft, FolderOpen, Plus, ChevronDown, Upload, Download, FolderUp, ClipboardPaste, ArrowUpDown, LayoutGrid, List, MoreHorizontal, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useActiveShell } from "@/features/appshell";
import { cn } from "@/lib/utils";
import { parentPath } from "../lib/format";
import { FileCrumbs } from "./file-crumbs";
import type { DragEvent } from "react";
import type { SortKey, ViewMode } from "../lib/types";

export type FilesToolbarProps = {
  path: string;
  query: string;
  onQuery: (query: string) => void;
  onRefresh: () => void;
  canBack: boolean;
  canForward: boolean;
  view: ViewMode;
  sort: SortKey;
  hasClipboard: boolean;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (path: string) => void;
  onView: (v: ViewMode) => void;
  onSort: (s: SortKey) => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onUploadFolder: () => void;
  onPaste: () => void;
  onOpenSidebar: () => void;
  selectedCount: number;
  onDownload: () => void;
  dropTarget: string | null;
  onCrumbDragOver: (e: DragEvent, dest: string) => void;
  onCrumbDragLeave: (dest: string) => void;
  onCrumbDrop: (e: DragEvent, dest: string) => void;
  onToggleSearch: () => void;
  searchOpen?: boolean;
  ios?: boolean;
};

export function DesktopFilesToolbar(p: FilesToolbarProps) {
  const { id } = useActiveShell();
  const windows = id === "windows";
  const folder = p.path === "~" ? "Home" : p.path.split("/").filter(Boolean).pop() || "Filesystem";
  const navigation = <div className="flex shrink-0 items-center gap-0.5">
    <Button variant="ghost" size="icon" aria-label="Open sidebar" onClick={p.onOpenSidebar} className="hidden size-8 @max-[600px]:inline-flex"><PanelLeft className="size-4" /></Button>
    <Button variant="ghost" size="icon" aria-label="Previous folder" disabled={!p.canBack} onClick={p.onBack} className="size-8"><ArrowLeft className="size-4" /></Button>
    <Button variant="ghost" size="icon" aria-label="Forward" disabled={!p.canForward} onClick={p.onForward} className="size-8"><ArrowRight className="size-4" /></Button>
    {windows && <Button variant="ghost" size="icon" aria-label="Up one level" disabled={p.path === "/" || p.path === "~"} onClick={() => p.onNavigate(parentPath(p.path))} className="size-8"><ArrowUp className="size-4" /></Button>}
    {windows && <Button variant="ghost" size="icon" aria-label="Refresh folder" onClick={p.onRefresh} className="size-8"><RotateCw className="size-4" /></Button>}
  </div>;
  const search = <div className={cn("relative min-w-0", windows ? "w-52 @max-[760px]:w-36" : "w-40 @max-[760px]:w-28")}>
    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
    <Input aria-label="Search this folder" placeholder={windows ? `Search ${folder}` : "Search"} value={p.query} onChange={(e) => p.onQuery(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") p.onQuery(""); }}
      className={cn("h-9 bg-background/70 pl-8 pr-7 text-xs shadow-none", windows ? "rounded-md" : "rounded-lg")} />
    {p.query && <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => p.onQuery("")} className="absolute right-1 top-1 size-7"><X className="size-3" /></Button>}
  </div>;
  const view = <div role="group" aria-label="Folder view" className={cn("flex shrink-0 items-center", !windows && "rounded-md bg-secondary p-0.5")}>
    <Button variant="ghost" size="icon" aria-label="Grid view" aria-pressed={p.view === "grid"} onClick={() => p.onView("grid")} className={cn("size-8", p.view === "grid" && "bg-background shadow-sm")}><LayoutGrid className="size-4" /></Button>
    <Button variant="ghost" size="icon" aria-label="List view" aria-pressed={p.view === "list"} onClick={() => p.onView("list")} className={cn("size-8", p.view === "list" && "bg-background shadow-sm")}><List className="size-4" /></Button>
  </div>;
  const sort = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="Sort" className="h-8 gap-1.5 px-2"><ArrowUpDown className="size-4" />{windows && <span className="text-xs">Sort</span>}<ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">{(["name", "kind", "size"] as const).map((key) => <DropdownMenuItem key={key} onSelect={() => p.onSort(key)} className={cn(p.sort === key && "bg-accent")}>{({ name: "Name", kind: windows ? "Type" : "Kind", size: "Size" })[key]}</DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>;
  const actions = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size={windows ? "sm" : "icon"} aria-label={windows ? "New" : "More actions"} className={cn("h-8 gap-1.5", !windows && "w-8")}>{windows ? <><Plus className="size-4" /><span className="text-xs">New</span><ChevronDown className="size-3" /></> : <MoreHorizontal className="size-5" />}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align={windows ? "start" : "end"}>
      <DropdownMenuItem onSelect={p.onNewFolder}><FolderOpen className="size-4" />New Folder</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={p.onUpload}><Upload className="size-4" />Upload Files…</DropdownMenuItem>
      <DropdownMenuItem onSelect={p.onUploadFolder}><FolderUp className="size-4" />Upload Folder…</DropdownMenuItem>
      {!windows && <><DropdownMenuSeparator /><DropdownMenuItem disabled={!p.hasClipboard} onSelect={p.onPaste}><ClipboardPaste className="size-4" />Paste</DropdownMenuItem>
        <DropdownMenuItem disabled={!p.selectedCount} onSelect={p.onDownload}><Download className="size-4" />Download</DropdownMenuItem>
        <DropdownMenuItem onSelect={p.onRefresh}><RotateCw className="size-4" />Refresh folder</DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
  const crumbs = <FileCrumbs path={p.path} dropTarget={p.dropTarget} onNavigate={p.onNavigate} onDragOver={p.onCrumbDragOver} onDragLeave={p.onCrumbDragLeave} onDrop={p.onCrumbDrop} />;

  return <div data-slot={windows ? "explorer-toolbar" : "finder-toolbar"} className={cn("border-b border-border", windows ? "bg-[var(--mica-win,var(--card))]" : "bg-sidebar/40")}>
    {windows ? <>
      <div className="flex min-h-12 items-center gap-2 overflow-x-auto border-b border-border px-3">
        {actions}<span className="h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="sm" disabled={!p.hasClipboard} onClick={p.onPaste} className="h-8 gap-2 text-xs"><ClipboardPaste className="size-4" />Paste</Button>
        <Button variant="ghost" size="sm" disabled={!p.selectedCount} onClick={p.onDownload} className="h-8 gap-2 text-xs"><Download className="size-4" />Download</Button>
        <span className="h-5 w-px shrink-0 bg-border" />{sort}{view}
      </div>
      <div className="flex min-h-14 items-center gap-2 px-2">
        {navigation}<div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background/70 px-2"><FolderOpen className="size-4 shrink-0 text-warning" />{crumbs}</div>{search}
      </div>
    </> : <>
      <div className="flex min-h-14 items-center gap-2 px-2">
        {navigation}<span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{folder}</span>
        {view}{sort}{actions}{search}
      </div>
      <div className="flex min-h-8 items-center gap-2 border-t border-border/60 px-3"><FolderOpen className="size-3.5 shrink-0 text-info" />{crumbs}</div>
    </>}
  </div>;
}

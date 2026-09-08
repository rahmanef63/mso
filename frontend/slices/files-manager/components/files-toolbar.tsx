import { ChevronRight, PanelLeft, Plus, Download, FolderUp, FileUp, LayoutGrid, List, ClipboardPaste, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DesktopFilesToolbar, type FilesToolbarProps } from "./desktop-files-toolbar";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FileCrumbs } from "./file-crumbs";
import type { SortKey } from "../lib/types";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "kind", label: "Kind" },
];

export function FilesToolbar(props: FilesToolbarProps) {
  // iOS Files: a slim bar — tint back chevron + path + iOS grid/list segment +
  // a single "+" overflow menu (New/Upload/Paste/Download/Sort), instead of the
  // dense desktop cluster. Data flow is unchanged; only the chrome is adapted.
  if (props.ios) {
    return (
      <div className="flex h-11 items-center gap-1.5 border-b border-border px-3">
        {/* Browse: opens the Favorites / roots drawer — the slim bar must keep
            this or those locations become unreachable on the phone. */}
        <Button variant="ghost" size="icon" onClick={props.onOpenSidebar} aria-label="Browse" className="size-9 shrink-0 text-primary [@media(pointer:coarse)]:size-[44px]">
          <PanelLeft className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" disabled={!props.canBack} onClick={props.onBack} aria-label="Previous folder" className="size-9 shrink-0 text-primary disabled:text-muted-foreground [@media(pointer:coarse)]:size-[44px]">
          <ChevronRight className="size-5 rotate-180" />
        </Button>
        <FileCrumbs
          path={props.path}
          dropTarget={props.dropTarget}
          onNavigate={props.onNavigate}
          onDragOver={props.onCrumbDragOver}
          onDragLeave={props.onCrumbDragLeave}
          onDrop={props.onCrumbDrop}
        />
        <div className="ml-auto flex shrink-0 items-center rounded-[9px] bg-secondary p-0.5">
          <Button variant="ghost" size="icon" aria-label="Grid view" onClick={() => props.onView("grid")} className={cn("size-8 rounded-[7px]", props.view === "grid" && "bg-background shadow-sm")}>
            <LayoutGrid className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="List view" onClick={() => props.onView("list")} className={cn("size-8 rounded-[7px]", props.view === "list" && "bg-background shadow-sm")}>
            <List className="size-3.5" />
          </Button>
        </div>
        <Button variant="ghost" size="icon" aria-label="Search" onClick={props.onToggleSearch} className={cn("size-9 shrink-0 text-primary [@media(pointer:coarse)]:size-[44px]", props.searchOpen && "bg-secondary")}>
          <Search className="size-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions" className="size-9 shrink-0 text-primary [@media(pointer:coarse)]:size-[44px]">
              <Plus className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onNewFolder}><Plus className="size-3.5" /> New Folder</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onUpload}><FileUp className="size-3.5" /> Upload Files…</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onUploadFolder}><FolderUp className="size-3.5" /> Upload Folder…</DropdownMenuItem>
            {props.hasClipboard && (
              <DropdownMenuItem onSelect={props.onPaste}><ClipboardPaste className="size-3.5" /> Paste</DropdownMenuItem>
            )}
            {props.selectedCount > 0 && (
              <DropdownMenuItem onSelect={props.onDownload}><Download className="size-3.5" /> Download ({props.selectedCount})</DropdownMenuItem>
            )}
            {SORTS.map((s) => (
              <DropdownMenuItem key={s.key} onSelect={() => props.onSort(s.key)} className={cn(props.sort === s.key && "text-primary")}>
                Sort: {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
  return <DesktopFilesToolbar {...props} />;
}

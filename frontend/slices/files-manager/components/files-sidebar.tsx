import { useActiveShell } from "@/features/appshell";
import { type DragEvent } from "react";
import {
  Home, Star, Image as ImageIcon, FolderOpen, FileText, Download, HardDrive,
  Trash2, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileTree } from "@/shared/file-tree";
import type { FsRoot, FsUsage } from "../lib/host";
import { fmtGiB } from "../lib/format";
import { TRASH_PATH } from "../hooks/use-files";

// Map a host-provided root label to an icon (falls back to a folder).
function iconFor(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l === "home") return Home;
  if (l === "filesystem" || l === "root") return HardDrive;
  if (l === "media") return ImageIcon;
  if (l === "documents") return FileText;
  if (l === "downloads") return Download;
  return FolderOpen;
}

// Sidebar CONTENT only (favorites · tree · storage). The window chrome
// (rail vs left Sheet on mobile) is provided by <AppSidebar> from os-shell.
export function FilesSidebar({
  path,
  roots,
  usage,
  dropTarget,
  onNavigate,
  onOpenFile,
  onEmptyTrash,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  path: string;
  roots: FsRoot[];
  usage: FsUsage | null;
  dropTarget: string | null;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
  onEmptyTrash: () => void;
  onDragOver: (e: DragEvent, dest: string) => void;
  onDragLeave: (dest: string) => void;
  onDrop: (e: DragEvent, dest: string) => void;
}) {
  // Favorites come from the host's real roots (Home/Projects/Filesystem live,
  // mock shortcuts in mock mode) — never hardcoded mock paths.
  const { id } = useActiveShell();
  const windows = id === "windows";
  const favorites = roots.length ? roots : [{ label: "Home", path: "~" }];
  const ratio = usage && usage.total > 0 ? usage.used / usage.total : 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1 text-[11px] font-semibold text-muted-foreground">
        {windows && <Star className="size-3.5" />}
        <span>{windows ? "Quick access" : "Favorites"}</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {favorites.map((fav) => {
          const Icon = iconFor(fav.label);
          const isActive = path === fav.path;
          const isDrop = dropTarget === fav.path;
          return (
            <Button
              key={fav.path}
              variant="ghost"
              size="sm"
              onClick={() => onNavigate(fav.path)}
              onDragOver={(e) => onDragOver(e, fav.path)}
              onDragLeave={() => onDragLeave(fav.path)}
              onDrop={(e) => onDrop(e, fav.path)}
              className={cn(
                "h-8 justify-start gap-2 rounded-md px-2 text-[13px] font-normal [@media(pointer:coarse)]:min-h-[44px]",
                isActive && (windows ? "bg-accent text-accent-foreground hover:bg-accent" : "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"),
                isDrop && "ring-2 ring-primary ring-inset",
              )}
            >
              <Icon className={cn("size-4 shrink-0", !isActive && (windows ? "text-warning" : "text-info"))} />
              <span className="truncate">{fav.label}</span>
            </Button>
          );
        })}
        <div className="my-1 h-px bg-border" />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate(TRASH_PATH)}
            onDragOver={(e) => onDragOver(e, TRASH_PATH)}
            onDragLeave={() => onDragLeave(TRASH_PATH)}
            onDrop={(e) => onDrop(e, TRASH_PATH)}
            className={cn(
              "h-8 flex-1 justify-start gap-2 px-2 text-xs font-medium",
              path === TRASH_PATH &&
                "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              dropTarget === TRASH_PATH && "ring-2 ring-primary ring-inset",
            )}
          >
            <Trash2 className="size-4 shrink-0" />
            <span className="truncate">{windows ? "Recycle Bin" : "Trash"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Empty Trash"
            title="Empty Trash"
            onClick={onEmptyTrash}
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </nav>
      <div className="my-1 h-px bg-border" />
      <FileTree
        rootPath="~"
        rootLabel={windows ? "Folders" : "Locations"}
        activePath={path}
        onSelectDir={onNavigate}
        onOpenFile={onOpenFile}
        className="min-h-0 flex-1 px-1"
      />
      <div className="space-y-1.5 border-t border-border p-3">
        <p className="text-[10px] font-semibold text-muted-foreground">Storage</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {usage ? `${fmtGiB(usage.used)} of ${fmtGiB(usage.total)}` : "—"}
        </p>
      </div>
    </div>
  );
}

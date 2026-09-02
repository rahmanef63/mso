"use client";

import { createElement } from "react";
import { Copy } from "lucide-react";
import type { FsEntry } from "../lib/host";
import { toast } from "@/features/appshell";
import { iconFor, colorFor } from "../lib/icons";
import { fmtSize, joinPath } from "../lib/format";
import { cn } from "@/lib/utils";

// Info strip at the bottom: icon, name, size, kind, full path + copy-path.
// With a selection it shows that entry; otherwise the current folder, so the
// address is always copyable.
export function FileDetails({
  entry,
  dir,
}: {
  entry: FsEntry | null;
  dir: string;
}) {
  const full = entry ? joinPath(dir, entry.name) : dir;
  const kind = !entry ? "Folder" : entry.kind === "dir" ? "Folder" : (entry.ext ?? "").toUpperCase() || "File";
  const copy = () =>
    void navigator.clipboard
      .writeText(full)
      .then(() => toast("Path copied", { tone: "success" }))
      .catch(() => toast("Copy failed", { tone: "error" }));

  return (
    <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-3 py-2">
      {/* createElement: dynamic stateless lookup, not a render-created component */}
      {entry && createElement(iconFor(entry), { className: cn("size-6 shrink-0", colorFor(entry)) })}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{entry?.name ?? "Current folder"}</span>
        <span className="truncate font-mono text-[10px] text-muted-foreground" title={full}>
          {full}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{kind}</span>
        {entry?.kind === "file" && <span className="tabular-nums">{fmtSize(entry.size)}</span>}
        <button
          type="button"
          title="Copy path"
          aria-label="Copy path"
          onClick={copy}
          className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

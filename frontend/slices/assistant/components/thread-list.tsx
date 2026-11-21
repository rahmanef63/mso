"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useShellDesign } from "@/features/appshell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { filterThreads, formatRelativeTime, sortThreads } from "./thread-list-model";

type Summary = { id: string; title: string; updatedAt: number };
type FullThread = { id: string; createdAt: number; messages: unknown[]; history: unknown[] };

// Left drawer of saved chats: resume loads the full thread back into the panel,
// New starts a fresh one, trash deletes (confirm-gated), pencil renames. Reads /api/threads.
export function ThreadList({
  open,
  onOpenChange,
  onResume,
  onNew,
  activeThreadId,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onResume: (t: FullThread) => void;
  onNew: () => void;
  activeThreadId?: string | null;
  onDeleted?: (id: string) => void;
}) {
  const [threads, setThreads] = useState<Summary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const design = useShellDesign();

  const load = useCallback(() => {
    fetch("/api/threads", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("load_failed"); return r.json(); })
      .then((d) => { setThreads(d.threads ?? []); setError(null); })
      .catch(() => setError("Failed to load chats"));
  }, []);

  // Fresh drawer chrome every open (render-time state adjustment — no effect
  // setState): reopening never lands mid-rename or with a stale error/confirm.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setEditingId(null);
      setConfirmDeleteId(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function resume(id: string) {
    try {
      const r = await fetch(`/api/threads?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!r.ok) { setError("Failed to resume chat"); return; }
      setError(null);
      onResume((await r.json()) as FullThread);
      onOpenChange(false);
    } catch {
      setError("Failed to resume chat");
    }
  }

  async function del(id: string) {
    try {
      const r = await fetch(`/api/threads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) { setError("Failed to delete chat"); return; }
      setError(null);
      setConfirmDeleteId(null);
      onDeleted?.(id);
      load();
    } catch {
      setError("Failed to delete chat");
    }
  }

  function startRename(t: Summary) {
    setEditingId(t.id);
    setEditingTitle(t.title);
    setConfirmDeleteId(null);
    setError(null);
  }

  async function saveRename(id: string) {
    const clean = editingTitle.trim();
    if (!clean) { setEditingId(null); return; }
    try {
      const r = await fetch("/api/threads", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, title: clean }),
      });
      if (!r.ok) { setError("Failed to rename chat"); return; }
      setEditingId(null);
      setError(null);
      load();
    } catch {
      setError("Failed to rename chat");
    }
  }

  const visibleThreads = sortThreads(filterThreads(threads, searchQuery));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-slot="shell-thread-list"
        data-shell-id={design.id}
        data-shell-family={design.family}
        side="left"
        className={cn("w-80 gap-0 p-0", design.family === "apple" && "rounded-r-[22px]", design.family === "material" && "rounded-r-[28px]")}
      >
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border p-3">
          <SheetTitle>Chats</SheetTitle>
          <Button size="sm" variant="ghost" className="[@media(pointer:coarse)]:min-h-[44px]" onClick={() => { onNew(); onOpenChange(false); }}>
            <Plus className="size-4" /> New
          </Button>
        </SheetHeader>
        <div className="border-b border-border p-2">
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search chats..." aria-label="Search chats" className="text-xs" />
        </div>
        {error ? (
          <div role="alert" className="flex items-center justify-between bg-muted px-3 py-1.5 text-xs text-destructive">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="hover:text-foreground" aria-label="Dismiss error">✕</button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No saved chats yet.</p>
          ) : visibleThreads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No matching chats found.</p>
          ) : (
            visibleThreads.map((t) => (
              <div key={t.id} className="border-b border-border">
                {confirmDeleteId === t.id ? (
                  <div className="flex items-center justify-between gap-2 bg-muted px-3 py-2 text-xs">
                    <span className="truncate text-destructive font-medium">Delete chat?</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="destructive" className="px-2 text-xs" onClick={() => void del(t.id)}>Confirm</Button>
                      <Button size="sm" variant="ghost" className="px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : editingId === t.id ? (
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void saveRename(t.id); if (e.key === "Escape") setEditingId(null); }}
                      autoFocus
                      className="text-xs"
                      aria-label="Rename chat"
                    />
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Save title" onClick={() => void saveRename(t.id)}><Check className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X className="size-4" /></Button>
                  </div>
                ) : (
                  <div className={cn("flex items-center", activeThreadId === t.id && "bg-accent/60")}>
                    <button
                      type="button"
                      aria-current={activeThreadId === t.id ? "true" : undefined}
                      onClick={() => resume(t.id)}
                      className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-[var(--hover-strong)] [@media(pointer:coarse)]:min-h-[44px]"
                    >
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">{formatRelativeTime(t.updatedAt)}</div>
                    </button>
                    <Button size="icon" variant="ghost" aria-label={`Rename ${t.title}`} onClick={() => startRename(t)} className="size-7 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-[44px]"><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => { setConfirmDeleteId(t.id); setEditingId(null); }} className="mr-1 size-7 shrink-0 text-muted-foreground hover:text-destructive [@media(pointer:coarse)]:size-[44px]"><Trash2 className="size-4" /></Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

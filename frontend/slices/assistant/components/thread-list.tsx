"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useShellDesign } from "@/features/os-shell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";

type Summary = { id: string; title: string; updatedAt: number };
type FullThread = { id: string; createdAt: number; messages: unknown[]; history: unknown[] };

// Left drawer of saved chats: resume loads the full thread back into the panel,
// New starts a fresh one, trash deletes. Reads /api/threads (YAML store).
export function ThreadList({
  open,
  onOpenChange,
  onResume,
  onNew,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onResume: (t: FullThread) => void;
  onNew: () => void;
}) {
  const [threads, setThreads] = useState<Summary[]>([]);
  const design = useShellDesign();

  const load = useCallback(() => {
    fetch("/api/threads", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((d) => setThreads(d.threads ?? []))
      .catch(() => setThreads([]));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function resume(id: string) {
    const r = await fetch(`/api/threads?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!r.ok) return;
    onResume((await r.json()) as FullThread);
    onOpenChange(false);
  }
  async function del(id: string) {
    await fetch(`/api/threads?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    load();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-slot="shell-thread-list"
        data-shell-id={design.id}
        data-shell-family={design.family}
        side="left"
        className={cn(
          "w-80 gap-0 p-0",
          design.family === "apple" && "rounded-r-[22px]",
          design.family === "material" && "rounded-r-[28px]",
        )}
      >
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-border p-3">
          <SheetTitle>Chats</SheetTitle>
          <Button
            size="sm"
            variant="ghost"
            className="[@media(pointer:coarse)]:min-h-[44px]"
            onClick={() => {
              onNew();
              onOpenChange(false);
            }}
          >
            <Plus className="size-4" /> New
          </Button>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No saved chats yet.</p>
          ) : (
            threads.map((t) => (
              <div key={t.id} className="flex items-center border-b border-border">
                <button
                  type="button"
                  onClick={() => resume(t.id)}
                  className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm hover:bg-[var(--hover-strong)] [@media(pointer:coarse)]:min-h-[44px]"
                >
                  {t.title}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${t.title}`}
                  onClick={() => del(t.id)}
                  className="mr-1 size-7 shrink-0 text-muted-foreground hover:text-destructive [@media(pointer:coarse)]:size-[44px]"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

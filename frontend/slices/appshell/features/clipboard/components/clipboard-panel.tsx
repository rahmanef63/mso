"use client";
import { useEffect, useState } from "react";
import { Pin, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "../../../primitives/responsive-dialog";
import { clearClips, copyClip, removeClip, setClipboardOpen, togglePinClip, useClips } from "../../../lib/clipboard";

export function ClipboardPanel() {
  const clips = useClips();
  const [q, setQ] = useState("");
  const [failedText, setFailedText] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { previous?.focus(); };
  }, []);
  const list = clips.filter((c) => c.text.toLowerCase().includes(q.toLowerCase()));

  return (
    <ResponsiveDialog open onOpenChange={setClipboardOpen} showCloseButton={false}>
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title>Clipboard history</ResponsiveDialog.Title>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body className="flex min-h-0 flex-col p-0">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          {clips.length > 0 && (
            <Button type="button" variant="ghost" onClick={clearClips} className="ml-auto h-auto p-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:underline">
              Clear unpinned
            </Button>
          )}
        </header>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clips…"
          className="w-full bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <ul className="min-h-0 flex-1 overflow-y-auto border-t border-border p-2">
          {failedText !== null && <li className="p-2"><p role="alert" className="text-sm text-destructive">Could not copy. Select the text and copy it manually.</p><textarea aria-label="Text to copy manually" readOnly value={failedText} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border border-border bg-background p-2 text-sm text-foreground" /></li>}
          {list.length === 0 && (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              {clips.length === 0 ? "Nothing copied yet. ⌘C anywhere in the OS lands here." : "No matches."}
            </li>
          )}
          {list.map((c) => (
            <li key={c.id} className="group flex items-center gap-1 rounded-lg px-1 hover:bg-primary/10">
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  if (await copyClip(c.text)) setClipboardOpen(false);
                  else setFailedText(c.text);
                }}
                className="h-auto min-w-0 flex-1 justify-start truncate p-2 text-left text-sm font-normal hover:bg-transparent"
              >
                {c.text}
              </Button>
              <Button
                type="button" variant="ghost" aria-label={c.pinned ? "Unpin" : "Pin"}
                onClick={() => togglePinClip(c.id)}
                className={cn("h-auto shrink-0 p-1 font-normal hover:bg-muted", c.pinned ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100")}
              >
                <Pin className="size-3.5" />
              </Button>
              <Button
                type="button" variant="ghost" aria-label="Remove"
                onClick={() => removeClip(c.id)}
                className="h-auto shrink-0 p-1 font-normal text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        <footer className="flex items-center border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          ⌘⇧V toggles · click copies
          <Button type="button" variant="ghost" aria-label="Close" onClick={() => setClipboardOpen(false)} className="ml-auto h-auto p-1 font-normal hover:bg-muted">
            <X className="size-3" />
          </Button>
        </footer>
      </ResponsiveDialog.Body>
    </ResponsiveDialog>
  );
}

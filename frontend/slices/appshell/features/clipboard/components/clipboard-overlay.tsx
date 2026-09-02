"use client";

import { useEffect, useState } from "react";
import { Pin, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  clearClips,
  copyClip,
  removeClip,
  setClipboardOpen,
  startClipboardCapture,
  toggleClipboard,
  togglePinClip,
  useClipboardOpen,
  useClips,
} from "../../../lib/clipboard";
import { inEditable } from "../../../lib/use-focused-hotkey";

// ⌘⇧V clipboard history — pinned entries stick, click copies back to the
// system clipboard. Capture (document copy/cut) starts with this feature.
// The panel MOUNTS per open, so the search query starts fresh every time
// without an effect-driven reset (react-hooks v6).
export function ClipboardOverlay() {
  const open = useClipboardOpen();

  useEffect(() => startClipboardCapture(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧V is the canonical terminal/editor paste — don't hijack it while the
      // user is typing; only summon the history panel from outside a field.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v" && !inEditable(e.target)) {
        e.preventDefault();
        toggleClipboard();
      } else if (e.key === "Escape") {
        setClipboardOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return open ? <ClipboardPanel /> : null;
}

function ClipboardPanel() {
  const clips = useClips();
  const [q, setQ] = useState("");
  const list = clips.filter((c) => c.text.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="absolute inset-0 z-[var(--z-clipboard)] flex items-start justify-center bg-black/20 pt-[16vh]" onClick={() => setClipboardOpen(false)}>
      <div className="glass flex max-h-[60vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-xs font-semibold text-muted-foreground">Clipboard history</span>
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
          {list.length === 0 && (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              {clips.length === 0 ? "Nothing copied yet — ⌘C anywhere in the OS lands here." : "No matches."}
            </li>
          )}
          {list.map((c) => (
            <li key={c.id} className="group flex items-center gap-1 rounded-lg px-1 hover:bg-primary/10">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  copyClip(c.text);
                  setClipboardOpen(false);
                }}
                className="h-auto min-w-0 flex-1 justify-start truncate p-2 text-left text-sm font-normal hover:bg-transparent"
              >
                {c.text}
              </Button>
              <Button
                type="button" variant="ghost" aria-label={c.pinned ? "Unpin" : "Pin"}
                onClick={() => togglePinClip(c.id)}
                className={cn("h-auto shrink-0 p-1 font-normal hover:bg-muted", c.pinned ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100")}
              >
                <Pin className="size-3.5" />
              </Button>
              <Button
                type="button" variant="ghost" aria-label="Remove"
                onClick={() => removeClip(c.id)}
                className="h-auto shrink-0 p-1 font-normal text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"
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
      </div>
    </div>
  );
}

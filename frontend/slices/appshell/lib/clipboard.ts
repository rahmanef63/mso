"use client";

import { useSyncExternalStore } from "react";
import { registerCommands } from "./commands";
import { toast } from "./toast";

// Clipboard history — captures in-OS copies (document copy/cut events) into a
// persisted, pinnable history (sv:clipboard). The bundled clipboard feature
// renders the ⌘⇧V overlay; selecting an entry writes it back to the system
// clipboard. Text-only by design (the web clipboard API gates the rest).

export type Clip = { id: number; text: string; ts: number; pinned?: boolean };

const KEY = "sv:clipboard";
const CAP = 25;

function load(): Clip[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Clip[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let clips: Clip[] = load();
let open = false;
const subs = new Set<() => void>();

// Monotonic id even when two clips land in the same millisecond — Date.now()
// alone produced duplicate ids, so pin/remove hit BOTH entries.
let lastId = clips.reduce((m, c) => Math.max(m, c.id), 0);
function nextId(ts: number): number {
  lastId = Math.max(lastId + 1, ts);
  return lastId;
}

function commit(next: Clip[]) {
  // newest first (id is monotonic — stable even within one ms); pinned never age out
  const pinned = next.filter((c) => c.pinned);
  const rest = next.filter((c) => !c.pinned).slice(0, CAP);
  clips = [...pinned, ...rest].sort((a, b) => b.id - a.id);
  try {
    localStorage.setItem(KEY, JSON.stringify(clips));
  } catch {
    /* ignore quota */
  }
  subs.forEach((f) => f());
}

/** Record copied text (deduped against the latest entry). */
export function recordClip(text: string): void {
  const t = text.trim();
  if (!t || clips[0]?.text === t) return;
  const ts = typeof Date !== "undefined" ? Date.now() : clips.length;
  commit([{ id: nextId(ts), text: t, ts }, ...clips.filter((c) => c.text !== t || c.pinned)]);
}

/** Write an entry back to the system clipboard (and bump its recency). */
export async function copyClip(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }
  recordClip(text);
  toast("Copied to clipboard");
  return true;
}

export function togglePinClip(id: number): void {
  commit(clips.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
}

export function removeClip(id: number): void {
  commit(clips.filter((c) => c.id !== id));
}

export function clearClips(): void {
  commit(clips.filter((c) => c.pinned));
}

export function listClips(): Clip[] {
  return clips;
}

export function setClipboardOpen(v: boolean): void {
  if (open === v) return;
  open = v;
  subs.forEach((f) => f());
}

export function toggleClipboard(): void {
  setClipboardOpen(!open);
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};

// SSR snapshot must be a stable constant matching the server render (empty /
// closed) — returning the client-loaded module state here would hydrate-mismatch.
const SSR_CLIPS: Clip[] = [];
export function useClips(): Clip[] {
  return useSyncExternalStore(subscribe, () => clips, () => SSR_CLIPS);
}
export function useClipboardOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/** Capture document copy/cut selections into the history. Idempotent. */
let capturing = false;
export function startClipboardCapture(): () => void {
  if (capturing || typeof document === "undefined") return () => {};
  capturing = true;
  const onCopy = () => {
    const text = window.getSelection?.()?.toString() ?? "";
    if (text) recordClip(text);
  };
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCopy);
  return () => {
    capturing = false;
    document.removeEventListener("copy", onCopy);
    document.removeEventListener("cut", onCopy);
  };
}

registerCommands("clipboard", [
  {
    id: "clipboard:history",
    label: "Clipboard history",
    hint: "Clipboard",
    keywords: "paste copy clips",
    run: () => setClipboardOpen(true),
  },
]);

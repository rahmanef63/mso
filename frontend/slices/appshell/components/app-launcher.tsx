"use client";

import Link from "next/link";
import { useIntentPrefetch } from "../hooks/use-intent-prefetch";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApps } from "../lib/registry";
import { useLauncherOpen } from "../hooks/use-shell";
import { openWindow, setLauncherOpen } from "../lib/store";
import { useQuickLinks } from "../registry/capabilities";
import { AppIcon } from "./app-icon";
import { QuicklinkIcon } from "./quicklink-icon";

// Launchpad — full-screen blurred app grid with a live filter (real-Launchpad).
// Derived from the registry. While closed it is `inert` + aria-hidden: the
// grid's ~20 links would otherwise stay in tab/AT order under the desktop
// (opacity-0 alone does not remove them). z-8400 keeps it under the clipboard
// overlay (8500) — overlays opened on top of Launchpad must win.
export function AppLauncher() {
  const open = useLauncherOpen();
  const prefetch = useIntentPrefetch(open);
  const apps = useApps();
  const { items: links, open: openLink } = useQuickLinks();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh search every open (render-time state adjustment — no effect setState),
  // focused for type-to-filter (like real Launchpad).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQ("");
  }
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const needle = q.trim().toLowerCase();
  const appList = needle ? apps.filter((a) => a.title.toLowerCase().includes(needle)) : apps;
  const linkList = needle ? links.filter((l) => l.title.toLowerCase().includes(needle)) : links;

  return (
    <div
      className={cn(
        "glass absolute inset-0 z-[var(--z-launcher)] flex flex-col items-center justify-center bg-black/30 transition-opacity",
        open ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      inert={!open}
      aria-hidden={!open}
      onClick={() => setLauncherOpen(false)}
    >
      <div
        className="mb-2 flex h-9 w-64 items-center gap-2 rounded-lg border border-white/25 bg-white/15 px-3 backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <Search className="size-3.5 text-white/70" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          aria-label="Search apps"
          className="w-full bg-transparent text-sm text-white placeholder:text-white/60 outline-none"
        />
      </div>
      {/* scrolls: a workspace with dozens of discovered feature apps overflows the
          centred column, and the rows past the fold were unreachable */}
      <div
        className="grid max-h-[76vh] w-full max-w-3xl grid-cols-4 gap-6 overflow-y-auto p-8 sm:grid-cols-5 md:grid-cols-6"
        onClick={(e) => e.stopPropagation()}
      >
        {appList.length + linkList.length === 0 && (
          <p className="col-span-full text-center text-sm text-white/70">No matches</p>
        )}
        {appList.map((app) => (
          <Link
            key={app.id}
            href={"/" + (app.slug ?? app.id)}
            prefetch={false}
            onPointerEnter={(event) => { if (open) prefetch.schedule(app, event.pointerType); }}
            onPointerLeave={prefetch.cancel}
            onFocus={() => { if (open) prefetch.schedule(app, "keyboard"); }}
            onBlur={prefetch.cancel}
            onClick={(e) => {
              if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                openWindow(app.id, app.title, app.defaultSize, undefined, { multi: app.multi });
              }
              setLauncherOpen(false);
            }}
            className="group flex flex-col items-center gap-2"
          >
            <span className="size-16 transition-transform group-hover:scale-105">
              <AppIcon app={app} />
            </span>
            <span className="text-xs font-medium text-white drop-shadow">{app.title}</span>
          </Link>
        ))}
        {linkList.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                openLink(link);
              }
              setLauncherOpen(false);
            }}
            className="group flex flex-col items-center gap-2"
          >
            <span className="size-16 transition-transform group-hover:scale-105">
              <QuicklinkIcon link={link} />
            </span>
            <span className="truncate text-xs font-medium text-white drop-shadow">{link.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

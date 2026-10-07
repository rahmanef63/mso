"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpotlightOpen } from "../../../hooks/use-shell";
import { useApps } from "../../../lib/registry";
import { useCommands } from "../../../lib/commands";
import { openWindow, setSpotlightOpen, setLauncherOpen, minimizeAll, closeAll } from "../../../lib/store";
import { toast } from "../../../lib/toast";
import { useActiveShell } from "../../../registry/shells";
import { useShellAppearance, useShellSearch, type SearchHit } from "../../../registry/capabilities";

import { matches, type Command } from "../lib";
import { loadRecents, pushRecent } from "../history";
import { ResultList } from "./spotlight-results";

// Mount per open so query and selection reset together.
export function Spotlight() {
  const open = useSpotlightOpen();
  return open ? <SpotlightPanel /> : null;
}

function SpotlightPanel() {
  const apps = useApps();
  const dynamic = useCommands();
  const search = useShellSearch();
  const { theme, setTheme } = useShellAppearance();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [recents] = useState(loadRecents);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ignore backdrop dismiss for the opening gesture (hot-corner / first click race).
  const dismissReady = useRef(false);
  const LISTBOX_ID = "spotlight-listbox";
  const ios = useActiveShell().id === "ios"; // iOS = top-anchored full-width search over the wallpaper

  // Keep prior folder results visible during the debounce.
  const [found, setFound] = useState<{ key: string; hits: SearchHit[]; error?: string } | null>(null);
  const folderHits = useMemo(() => (q.trim() ? (found?.hits ?? []) : []), [q, found]);
  const trimmed = q.trim();
  const searchError = trimmed && found?.key === trimmed ? found.error : undefined;
  // Do not report no matches until the folder query settles.
  const folderPending = Boolean(trimmed && found?.key !== trimmed);
  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    let alive = true;
    const t = setTimeout(() => {
      search(query)
        .then((h) => alive && setFound({ key: query, hits: h }))
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          if (alive) setFound({ key: query, hits: [], error: msg });
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, search]);

  const commands = useMemo<Command[]>(() => {
    const appCmds: Command[] = apps.map((app) => ({
      id: `open:${app.id}`,
      label: app.title,
      hint: "App",
      app,
      run: () => openWindow(app.id, app.title, app.defaultSize, undefined, { multi: app.multi }),
    }));
    const actions: Command[] = [
      { id: "launchpad", label: "Open Launchpad", hint: "Action", run: () => setLauncherOpen(true) },
      { id: "minimize-all", label: "Minimize all windows", hint: "Action", run: minimizeAll },
      { id: "close-all", label: "Close all windows", hint: "Action", run: closeAll },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        hint: "Action",
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
    ];
    const registered: Command[] = dynamic.map((c) => ({
      id: c.id,
      label: c.label,
      hint: c.hint ?? "Action",
      keywords: c.keywords,
      run: c.run,
    }));
    return [...appCmds, ...actions, ...registered];
  }, [apps, theme, setTheme, dynamic]);

  const results = useMemo(() => {
    let base = commands.filter((c) => matches(q, c.keywords ? `${c.label} ${c.keywords}` : c.label));
    if (!q.trim() && recents.length) {
      const rank = new Map(recents.map((id, i) => [id, i]));
      base = [...base].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    }
    const folderCmds: Command[] = folderHits.map((h) => ({
      id: h.id,
      label: h.label,
      hint: h.hint ?? "Folder",
      run: h.run,
    }));
    return [...base, ...folderCmds];
  }, [commands, q, folderHits, recents]);

  // Retry focus after deferred mount; restore the opener on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    let cancelled = false;
    const focus = () => {
      if (!cancelled) inputRef.current?.focus();
    };
    const id1 = requestAnimationFrame(() => {
      focus();
      requestAnimationFrame(focus);
    });
    const id2 = window.setTimeout(focus, 50);
    const ready = window.setTimeout(() => {
      dismissReady.current = true;
    }, 180);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id1);
      window.clearTimeout(id2);
      window.clearTimeout(ready);
      prev?.focus?.();
    };
  }, []);
  const selIdx = Math.min(sel, Math.max(0, results.length - 1));

  const close = () => setSpotlightOpen(false);
  const onBackdrop = () => {
    if (!dismissReady.current) return;
    close();
  };
  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    pushRecent(cmd.id);
    cmd.run();
    toast(cmd.app ? `Opened ${cmd.label}` : cmd.label);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (s + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (s - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(selIdx);
    }
  };

  const emptyMessage = searchError
    ? `Pencarian gagal: ${searchError}`
    : folderPending
      ? "Searching…"
      : `No matches for “${q}”.`;

  return (
    <div
      className={cn(
        "absolute inset-0 z-[var(--z-spotlight)] flex items-start justify-center bg-black/20",
        ios ? "pt-[calc(var(--sai-top)_+_0.5rem)]" : "pt-[18vh]",
      )}
      onClick={onBackdrop}
    >
      <div
        className={cn(
          "spotlight-panel w-full overflow-hidden rounded-2xl border border-border text-foreground shadow-2xl",
          ios ? "max-w-[calc(100%_-_1.5rem)]" : "max-w-xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* iOS: input becomes a systemFill pill with a leading search glyph. */}
        <div className={cn("flex items-center", ios && "m-3 gap-2 rounded-xl bg-[var(--fill)] px-3")}>
          {ios && <Search className="size-[15px] shrink-0 text-muted-foreground" />}
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Spotlight search"
            aria-expanded={results.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={results.length > 0 ? `spotlight-option-${selIdx}` : undefined}
            aria-autocomplete="list"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search apps, folders, actions…"
            className={cn(
              "w-full bg-transparent text-base text-foreground outline-none placeholder:text-foreground/55",
              ios ? "py-2.5" : "px-5 py-4",
            )}
          />
        </div>
        {results.length > 0 && (
          <ResultList id={LISTBOX_ID} results={results} selIdx={selIdx} onHover={setSel} onPick={runAt} />
        )}
        {results.length === 0 && (
          <p
            role={searchError ? "alert" : folderPending ? "status" : undefined}
            aria-live={folderPending ? "polite" : undefined}
            className={cn(
              "border-t border-border px-5 py-4 text-sm",
              searchError ? "text-destructive" : "text-foreground/70",
            )}
          >
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  );
}

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

// The panel MOUNTS per open (and unmounts on close), so query/selection state
// starts fresh every time without effect-driven resets (set-state-in-effect).
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
  // Read MRU once per open (panel mounts on open), so recents refresh each time.
  const [recents] = useState(loadRecents);
  const inputRef = useRef<HTMLInputElement>(null);
  const LISTBOX_ID = "spotlight-listbox";
  const ios = useActiveShell().id === "ios"; // iOS = top-anchored full-width search over the wallpaper

  // Debounced folder search under ~/projects (live) — opens Files at the hit.
  // Results are state, but "no query → no hits" is derived below (stale hits
  // stay visible during the debounce, matching the old behaviour).
  const [found, setFound] = useState<{ key: string; hits: SearchHit[]; error?: string } | null>(null);
  const folderHits = useMemo(() => (q.trim() ? (found?.hits ?? []) : []), [q, found]);
  const searchError = q.trim() && found?.key === q.trim() ? found.error : undefined;
  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    let alive = true;
    const t = setTimeout(() => {
      search(query)
        .then((h) => alive && setFound({ key: query, hits: h }))
        // Keep the reason. Reporting a dead host API as "No matches" is a lie the
        // user cannot act on — an expired session looks exactly like an empty
        // folder. Files does this right (use-files.ts toasts the real message).
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
    // Registry-contributed commands (apps/features/shells register at runtime).
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
    // Empty query → float recently-run commands to the top (recency order).
    // Array.sort is stable, so non-recent commands keep their catalog order.
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

  // Focus the input after the open transition paints (mount = open), and on
  // close return focus to whatever was focused before — so keyboard/AT users
  // aren't dumped at the top of the document when Spotlight dismisses.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      prev?.focus?.();
    };
  }, []);

  // Clamp the selection in render when results shrink — no clamp effect.
  const selIdx = Math.min(sel, Math.max(0, results.length - 1));

  const close = () => setSpotlightOpen(false);
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

  return (
    <div
      className={cn(
        "absolute inset-0 z-[var(--z-spotlight)] flex items-start justify-center bg-black/20",
        ios ? "pt-[calc(var(--sai-top)_+_0.5rem)]" : "pt-[18vh]",
      )}
      onClick={close}
    >
      <div
        className={cn(
          "glass w-full overflow-hidden rounded-2xl border border-border shadow-2xl",
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
            className={cn("w-full bg-transparent text-base outline-none placeholder:text-muted-foreground", ios ? "py-2.5" : "px-5 py-4")}
          />
        </div>
        {results.length > 0 && (
          <ResultList id={LISTBOX_ID} results={results} selIdx={selIdx} onHover={setSel} onPick={runAt} />
        )}
        {results.length === 0 && (
          <p
            role={searchError ? "alert" : undefined}
            className={cn(
              "border-t border-border px-5 py-4 text-sm",
              searchError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {searchError ? `Pencarian gagal: ${searchError}` : `No matches for “${q}”.`}
          </p>
        )}
      </div>
    </div>
  );
}


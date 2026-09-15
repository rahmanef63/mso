"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppDescriptor } from "../lib/types";
import { AppIcon } from "./app-icon";
import { FolderCard, AlphaList } from "./mobile-app-library-parts";

// Category map keyed by app id (SSOT for grouping). Unknown ids → "Other" so
// dynamically-installed apps still show up.
const CATEGORY: Record<string, string> = {
  "files-manager": "Files & System",
  "os-terminal": "Files & System",
  "system-monitor": "Files & System",
  "os-settings": "Files & System",
  "media-studio": "Creative",
  "reel-editor": "Creative",
  "media-viewer": "Creative",
  "code-editor": "Develop",
  "create-app": "Develop",
  browser: "Web & AI",
  assistant: "Web & AI",
  organization: "Work & Automation",
  workflows: "Work & Automation",
  integrations: "Work & Automation",
  "app-store": "Web & AI",
};
const ORDER = ["Files & System", "Creative", "Develop", "Work & Automation", "Web & AI", "Other"];

// iPhone App Library: category folder-cards by default; an A–Z list while the
// search field has text. Tapping a folder's cluster (or its label) opens it.
export function MobileAppLibrary({
  apps,
  onOpen,
}: {
  apps: AppDescriptor[];
  onOpen: (app: AppDescriptor) => void;
}) {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string | null>(null);

  const groups = useMemo(() => {
    const by: Record<string, AppDescriptor[]> = {};
    for (const a of apps) (by[CATEGORY[a.id] ?? "Other"] ??= []).push(a);
    return ORDER.filter((c) => by[c]?.length).map((name) => ({ name, apps: by[name] }));
  }, [apps]);

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return apps
      .filter((a) => a.title.toLowerCase().includes(query))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [apps, q]);

  const folderApps = folder ? (groups.find((g) => g.name === folder)?.apps ?? []) : [];

  return (
    <div className="relative flex h-full flex-col px-4 py-3">
      <h2 className="mb-2 px-1 text-lg font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
        App Library
      </h2>
      <label
        className="mb-3 flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 backdrop-blur-xl"
        style={{ background: "var(--glass-menu)" }}
      >
        <Search className="size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="App Library"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>

      {q ? (
        <AlphaList apps={matches} q={q} onOpen={onOpen} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto [scrollbar-width:none]">
          {groups.map((g) => (
            <FolderCard key={g.name} name={g.name} apps={g.apps} onOpen={onOpen} onExpand={() => setFolder(g.name)} />
          ))}
        </div>
      )}

      {folder && (
        <div
          className="absolute inset-0 z-[30] flex bg-black/55 backdrop-blur-md"
          onClick={() => setFolder(null)}
        >
          <div
            className="m-auto w-[90%] rounded-3xl border border-white/15 p-5"
            style={{ background: "var(--glass-menu)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-center text-base font-semibold">{folder}</h3>
            <div className="grid grid-cols-4 gap-x-3 gap-y-4">
              {folderApps.map((a) => (
                <Button key={a.id} type="button" variant="ghost" onClick={() => onOpen(a)} className="h-auto p-0 hover:bg-transparent flex flex-col items-center gap-1.5">
                  {/* 60px, the iPhone icon size — an opened App Library folder shows
                      full-size icons, not the shrunken ones the closed card packs
                      into its 2×2 preview. Was 56px. The 4-column card is ~69px per
                      cell here, so 60 fits without reflowing the overlay. */}
                  <span className="aspect-square w-full max-w-[60px]">
                    <AppIcon app={a} />
                  </span>
                  <span className="max-w-full truncate text-[11px] font-medium leading-[13px]">{a.title}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


"use client";

import { useMemo, useState } from "react";
import { Search, Sparkles, Store } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { AppFrame, useContainer, useActiveShell, useContextZone, openWindow } from "@/features/os-shell";
import type { MenuItem } from "@/features/os-shell";
import { UninstallConfirm } from "./components/uninstall-confirm";
import { usePublishInspector } from "./lib/host";
import {
  StoreFilterChips,
  StoreSidebar,
  type StoreFilter,
} from "./components/store-sidebar";
import { FeaturedCard } from "./components/featured-card";
import { StoreAppCard } from "./components/store-app-card";
import { SystemCard } from "./components/system-card";
import { FEATURED_ID, mergeCatalog } from "./lib/store-catalog";
import { SYSTEM_CATALOG } from "./lib/system-catalog";
import { useApps } from "./lib/apps-store";
import { useDisabledIds } from "./lib/enabled-store";
import { useStoreInstall } from "./lib/use-store-install";

// Default export so os-shell can lazy-load it as a window app. Installing an app
// flips its localStorage row (useInstalledApps surfaces it in the dock/launchpad).
// The "Apps"/"Features" sections instead toggle the built-in apps + shell features
// on/off (enabled-store) — os-root filters the manifest by the disabled set.
export default function AppStore() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StoreFilter>("Featured");
  // Store-level zone: a right-click anywhere in the grid gets this, and a
  // right-click ON a card merges the card's items ABOVE it (nested).
  const storeZone = useContextZone((): MenuItem[] => [
    { label: "Suggest an app…", icon: Sparkles, onClick: () => openWindow("assistant", "Alfa") },
  ]);
  // Pane-width bucket (JS, not CSS): the sidebar/chip swap must share ONE
  // measurement, and the chips live inside the AppFrame's own @container.
  const [paneRef, pane] = useContainer<HTMLDivElement>();
  const compact = pane === "xs" || pane === "sm";
  // Mobile shell navigation already owns the App Store title on both mobile OSes,
  // so the in-content title is desktop-only; iOS still gets its systemFill search.
  const activeShell = useActiveShell();
  const ios = activeShell.id === "ios";
  const mobile = activeShell.surface === "mobile";

  const rows = useApps();
  const disabled = useDisabledIds();
  const off = useMemo(() => new Set(disabled), [disabled]);
  const isSystem = filter === "Apps" || filter === "Features";

  // Merge curated catalog with live install state from localStorage.
  const catalog = useMemo(() => mergeCatalog(rows), [rows]);
  const featured = catalog.find((a) => a.appId === FEATURED_ID) ?? catalog[0];

  // Install state machine + destructive confirm gates (uninstall = needs prompt).
  const install = useStoreInstall(off);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((a) => {
      if (filter !== "Featured" && a.category !== filter) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, filter]);

  const systemList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kind = filter === "Features" ? "feature" : "app";
    return SYSTEM_CATALOG.filter(
      (e) =>
        e.kind === kind &&
        (!q || e.title.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q)),
    );
  }, [filter, query]);

  const count = isSystem ? systemList.length : list.length;
  const noun = isSystem ? (filter === "Features" ? "feature" : "app") : "app";
  const installedCount = catalog.filter((a) => a.installed).length;

  // Surface store state to the shell AI Inspector.
  usePublishInspector(
    "app-store",
    {
      subject: "App Store",
      props: [
        { label: "Installed", value: String(installedCount) },
        { label: "Catalog", value: String(catalog.length) },
        { label: "Uninstalled", value: String(disabled.length) },
      ],
      context: `App store, ${installedCount} installed, ${disabled.length} uninstalled`,
      suggestions: ["Suggest an app", "What's installed?"],
    },
    [installedCount, catalog.length, disabled.length],
  );

  return (
    <div ref={paneRef} className="flex h-full">
      {!compact && <StoreSidebar value={filter} onChange={setFilter} />}

      <AppFrame
        className="min-w-0 flex-1"
        safeArea={false}
        header={
          <header className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              {!mobile && <Store className="size-4 text-primary" />}
              {!mobile && <h2 className="text-sm font-semibold">App Store</h2>}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {count} {count === 1 ? noun : `${noun}s`}
              </span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isSystem ? `Search ${noun}s` : "Search apps"}
                className={ios ? "h-9 border-0 bg-[var(--fill)] pl-8" : "h-9 pl-8"}
              />
            </div>
            {compact && <StoreFilterChips value={filter} onChange={setFilter} />}
          </header>
        }
      >
        <ScrollArea className="h-full">
          <div ref={storeZone} className="p-4 [padding-bottom:calc(1rem+var(--sai-bottom))]">
            {isSystem ? (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  Optional {filter === "Features" ? "system features" : "apps"} — install to add
                  them, uninstall to remove. Uninstalled items vanish from the dock, Launchpad,
                  and Spotlight.
                </p>
                <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
                  {systemList.map((e) => (
                    <SystemCard
                      key={e.id}
                      entry={e}
                      installed={!off.has(e.id)}
                      onToggle={install.toggleSystem}
                    />
                  ))}
                </div>
              </>
            ) : (
              <>
                {filter === "Featured" && featured && !query && (
                  <FeaturedCard
                    app={featured}
                    onToggle={install.toggle}
                  />
                )}

                {list.length === 0 ? (
                  <p className="py-12 text-center text-xs text-muted-foreground">
                    No apps match &ldquo;{query}&rdquo;.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
                    {list.map((app) => (
                      <StoreAppCard
                        key={app.appId}
                        app={app}
                        onToggle={install.toggle}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </AppFrame>

      <UninstallConfirm
        open={install.pendingApp !== null}
        title={install.pendingApp?.title ?? null}
        onCancel={install.cancelApp}
        onConfirm={install.confirmUninstallApp}
      />
      <UninstallConfirm
        open={install.pendingSystem !== null}
        title={install.pendingSystem?.title ?? null}
        onCancel={install.cancelSystem}
        onConfirm={install.confirmUninstallSystem}
      />
    </div>
  );
}

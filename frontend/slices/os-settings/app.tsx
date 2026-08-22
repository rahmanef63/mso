"use client";

import { useEffect, useState } from "react";
import { useAppearance, effectiveServerTarget } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import {
  AppFrame,
  MasterDetail,
  useActiveShell,
  usePublishInspector,
  toast,
} from "@/features/os-shell";
import { SettingsTabs, SettingsSidebar, type SectionId } from "./components/nav";
import { SectionDetail, SectionList } from "./components/sections";
import { IosSettings } from "./components/ios-settings";

// Default export so os-shell can lazy-load it as a window app.
export default function OsSettings() {
  const { tweaks } = useAppearance();
  // The active shell drives per-shell Settings layout (same sections, different
  // navigation chrome) — the per-shell feature-config seam.
  const { id: shellId, surface } = useActiveShell();
  const [model, setModel] = useState("default");
  // On mobile we start on the section list (no selection drilled in); desktop
  // always shows a selected pane. `null` = list view, an id = detail view.
  const [active, setActive] = useState<SectionId | null>(
    surface === "mobile" ? null : "appearance",
  );
  const serverTarget = effectiveServerTarget(tweaks.server);

  useEffect(() => {
    // Demo never calls /api (no auth) — the fetch would 401 and greet every
    // visitor with an error toast. The default model label stands in.
    if (IS_DEMO) return;
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((c) => c?.model && setModel(`${c.provider ?? "provider"}/${c.model}`))
      .catch(() => toast("Failed to load AI config", { tone: "error" }));
  }, []);

  // Surface system preferences to the shell AI Inspector.
  usePublishInspector(
    "os-settings",
    {
      subject: "System Settings",
      props: [
        { label: "Theme", value: tweaks.preset ?? "stock" },
        { label: "Mode", value: tweaks.theme },
        { label: "Device", value: tweaks.device },
        { label: "Font", value: `${Math.round(tweaks.fontScale * 100)}%` },
        { label: "Wallpaper", value: tweaks.wallpaperImage ? "custom image" : tweaks.wallpaper },
        { label: "Server target", value: serverTarget?.label ?? tweaks.server.mode },
        { label: "AI model", value: model },
      ],
      context: `Settings: theme ${tweaks.theme}, server target ${serverTarget?.label ?? tweaks.server.mode}`,
      suggestions: [
        "What do server target tabs do?",
        "Recommended settings",
        "Explain device approval",
      ],
    },
    [tweaks.theme, tweaks.preset, tweaks.device, tweaks.fontScale, tweaks.wallpaper, tweaks.wallpaperImage, tweaks.server.mode, serverTarget?.label, model],
  );

  // Per-shell layout — SAME sections + section bodies, only the navigation chrome
  // differs: iOS/Android push a nav-stack, macOS shows a colored sidebar, Windows
  // a top tab strip. This IS the per-shell feature-config pattern (one component,
  // useActiveShell() picks the config).
  const layout: "stack" | "sidebar" | "tabs" =
    surface === "mobile" ? "stack" : shellId === "macos" ? "sidebar" : "tabs";

  // iOS Settings owns its full native navigation stack: the generic iOS app
  // header is disabled by the app descriptor, so the root can use Apple's
  // large-title/search hierarchy and detail pages can own the Settings back row.
  if (surface === "mobile" && shellId === "ios") {
    return (
      <AppFrame safeArea={false} bodyClassName="overflow-hidden">
        <IosSettings active={active} onSelect={setActive} onBack={() => setActive(null)} />
      </AppFrame>
    );
  }

  // Android keeps the shared MasterDetail drill-down and Android shell chrome.
  if (layout === "stack") {
    return (
      <AppFrame>
        <MasterDetail
          master={<SectionList active={active} onSelect={setActive} />}
          detail={active ? <SectionDetail id={active} /> : null}
          hasSelection={active !== null}
          onBack={() => setActive(null)}
          backLabel="Settings"
          masterClassName="w-full"
        />
      </AppFrame>
    );
  }

  const desktopActive: SectionId = active ?? "appearance";

  // macOS: System Settings sidebar + detail (colored category tiles at left).
  if (layout === "sidebar") {
    return (
      <AppFrame>
        <div className="flex h-full min-h-0">
          <aside className="w-56 shrink-0 border-r border-border bg-sidebar/40">
            <SettingsSidebar active={desktopActive} onSelect={setActive} />
          </aside>
          <div className="min-w-0 flex-1">
            <SectionDetail id={desktopActive} />
          </div>
        </div>
      </AppFrame>
    );
  }

  // Windows / Dashboard: top tab strip — every section visible at a glance.
  return (
    <AppFrame
      toolbar={
        <div className="bg-sidebar/40">
          <SettingsTabs active={desktopActive} onSelect={setActive} />
        </div>
      }
    >
      <SectionDetail id={desktopActive} />
    </AppFrame>
  );
}

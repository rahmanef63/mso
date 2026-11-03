"use client";

import { useSearchParams } from "next/navigation";
import { initialAboutPage } from "./lib/about-pages";
import { sectionFromSearch } from "./lib/sections";
import { useEffect, useState } from "react";
import { useAppearance, effectiveServerTarget } from "@/lib/appearance";
import { useSession } from "@/features/auth";
import { IS_DEMO } from "@/lib/demo";
import {
  useActiveShell,
  usePublishInspector,
  useFeatureState,
  setCloseGuard,
  toast,
} from "@/features/appshell";
import type { SectionId } from "./lib/sections";
import { AboutPageState } from "./components/about-page-state";
import { SettingsShell } from "./components/settings-shell";
import { SettingsWindowContext } from "./lib/window-context";

// Default export so os-shell can lazy-load it as a window app.
export default function OsSettings({ winId }: { winId?: string }) {
  const params = useSearchParams();
  const initial = sectionFromSearch(params.get("section"));
  const { tweaks } = useAppearance();
  const { status, role } = useSession();
  // Shared Settings state stays here; SettingsShell selects the presentation profile.
  // No shell-specific layout/config lives in this headless app controller.
  const { surface } = useActiveShell();
  const [model, setModel] = useState("default");
  const [sensitiveDirty, setSensitiveDirty] = useState(false);
  // On mobile we start on the section list (no selection drilled in); desktop
  // always shows a selected pane. `null` = list view, an id = detail view.
  const [active, setActive] = useFeatureState<SectionId | null>(winId, "settings-section",
    initial ?? (surface === "mobile" ? null : "appearance"),
  );
  const [draftName] = useFeatureState(winId, "provider-name", "");
  const [draftUrl] = useFeatureState(winId, "provider-url", "");
  const [draftModels] = useFeatureState(winId, "provider-models", "");
  const draftDirty = Boolean(draftName || draftUrl || draftModels || sensitiveDirty);
  useEffect(() => {
    if (!draftDirty) return;
    if (winId) setCloseGuard(winId, () => window.confirm("Discard the unsaved provider draft?"));
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      if (winId) setCloseGuard(winId, null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [draftDirty, winId]);
  const serverTarget = effectiveServerTarget(tweaks.server);

  useEffect(() => {
    // Demo never calls /api (no auth) — the fetch would 401 and greet every
    // visitor with an error toast. The default model label stands in.
    if (IS_DEMO || status !== "in" || role !== "owner") return;
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((c) => c?.model && setModel(`${c.provider ?? "provider"}/${c.model}`))
      .catch(() => toast("Failed to load AI config", { tone: "error" }));
  }, [status, role]);

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

  return (
    <SettingsWindowContext.Provider value={{ winId, setSensitiveDirty }}>
      <AboutPageState initial={initialAboutPage(initial ?? null, params.get("page"))}>
        <SettingsShell active={active} onSelect={(next) => {
          if (next !== active && sensitiveDirty && !window.confirm("Discard the unsaved API key or JSON?")) return;
          if (next !== active) setSensitiveDirty(false);
          setActive(next);
        }} />
      </AboutPageState>
    </SettingsWindowContext.Provider>
  );
}

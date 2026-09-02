"use client";

import { useEffect, useState } from "react";
import { useAppearance, effectiveServerTarget } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import {
  useActiveShell,
  usePublishInspector,
  toast,
} from "@/features/appshell";
import type { SectionId } from "./lib/sections";
import { SettingsShell } from "./components/settings-shell";

// Default export so os-shell can lazy-load it as a window app.
export default function OsSettings() {
  const { tweaks } = useAppearance();
  // Shared Settings state stays here; SettingsShell selects the presentation profile.
  // No shell-specific layout/config lives in this headless app controller.
  const { surface } = useActiveShell();
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

  return <SettingsShell active={active} onSelect={setActive} />;
}

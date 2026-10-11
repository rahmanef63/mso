"use client";

import { useCallback, useState } from "react";

import { setInstalled } from "./apps-store";
import { setEnabled, isAppEnabled, type EnabledOverrides } from "./enabled-store";
import { shellStore, closeWindow, focusWindow } from "@/features/appshell";
import type { CatalogApp } from "./store-catalog";
import type { SystemEntry } from "./system-catalog";

// Install/uninstall state machine for the App Store. Touch users have no
// hover affordance, so tapping the "Installed" pill instantly fires uninstall —
// that's the destructive path we gate behind a confirm. Install is instant.
// Returns the toggles cards bind to, the busy id (per-card spinner), the
// pending entries (drive the dialogs), and the confirm callbacks.
export function useStoreInstall(enabled: EnabledOverrides) {
  const [pendingApp, setPendingApp] = useState<CatalogApp | null>(null);
  const [pendingSystem, setPendingSystem] = useState<SystemEntry | null>(null);

  const doInstall = useCallback((app: CatalogApp, nextInstalled: boolean) => {
    setInstalled({
      appId: app.appId,
      installed: nextInstalled,
      title: app.title,
      glyph: app.glyph,
      gradient: app.gradient,
      runtime: app.runtime,
      entry: app.entry,
    });
  }, []);

  const toggle = useCallback(
    (app: CatalogApp) => {
      if (app.installed) setPendingApp(app);
      else doInstall(app, true);
    },
    [doInstall],
  );

  const toggleSystem = useCallback(
    (e: SystemEntry) => {
      const currentlyInstalled = e.kind === "app" ? isAppEnabled(e.id, enabled) : enabled[e.id] !== false;
      // Confirm before disabling, instant on re-enable (not destructive).
      if (currentlyInstalled) setPendingSystem(e);
      else setEnabled(e.id, true);
    },
    [enabled],
  );

  const confirmUninstallApp = useCallback(() => {
    if (pendingApp) doInstall(pendingApp, false);
    setPendingApp(null);
  }, [doInstall, pendingApp]);

  const confirmUninstallSystem = useCallback(() => {
    if (pendingSystem?.kind === "app") {
      const windows = shellStore.getOrder().filter(id => shellStore.getWindow(id)?.app === pendingSystem.id);
      windows.forEach(id => closeWindow(id));
      const blocked = windows.find(id => shellStore.getWindow(id));
      if (blocked) { focusWindow(blocked); setPendingSystem(null); return; }
    }
    if (pendingSystem) setEnabled(pendingSystem.id, false);
    setPendingSystem(null);
  }, [pendingSystem]);

  return {
    pendingApp,
    pendingSystem,
    toggle,
    toggleSystem,
    cancelApp: () => setPendingApp(null),
    cancelSystem: () => setPendingSystem(null),
    confirmUninstallApp,
    confirmUninstallSystem,
  };
}

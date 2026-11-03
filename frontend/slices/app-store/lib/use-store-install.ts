"use client";
import { useCallback, useState } from "react";
import { setInstalled } from "./apps-store";
import { setEnabled } from "./enabled-store";
import type { CatalogApp } from "./store-catalog";
import type { SystemEntry } from "./system-catalog";

export function useStoreInstall(off: Set<string>) {
  const [pendingApp, setPendingApp] = useState<CatalogApp | null>(null);
  const [pendingSystem, setPendingSystem] = useState<SystemEntry | null>(null);
  const [error, setError] = useState("");
  const persist = useCallback((change: () => void) => {
    setError("");
    try { change(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change could not be saved."); return false; }
  }, []);
  const doInstall = useCallback((app: CatalogApp, installed: boolean) => persist(() => setInstalled({
    appId: app.appId, installed, title: app.title, glyph: app.glyph,
    gradient: app.gradient, runtime: app.runtime, entry: app.entry,
  })), [persist]);
  const toggle = useCallback((app: CatalogApp) => {
    if (app.installed) setPendingApp(app);
    else doInstall(app, true);
  }, [doInstall]);
  const toggleSystem = useCallback((entry: SystemEntry) => {
    if (!off.has(entry.id)) setPendingSystem(entry);
    else persist(() => setEnabled(entry.id, true));
  }, [off, persist]);
  const confirmUninstallApp = useCallback(() => {
    if (pendingApp && doInstall(pendingApp, false)) setPendingApp(null);
  }, [doInstall, pendingApp]);
  const confirmUninstallSystem = useCallback(() => {
    if (pendingSystem && persist(() => setEnabled(pendingSystem.id, false))) setPendingSystem(null);
  }, [pendingSystem, persist]);
  return {
    error, pendingApp, pendingSystem, toggle, toggleSystem,
    cancelApp: () => { setPendingApp(null); setError(""); },
    cancelSystem: () => { setPendingSystem(null); setError(""); },
    confirmUninstallApp, confirmUninstallSystem,
  };
}

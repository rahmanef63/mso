"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Globe } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";
import { shellAppId, type ShellAppChange, type ShellAppSnapshot } from "@/lib/contracts/shell-app";

const EMPTY: ShellAppSnapshot = { schemaVersion: 1, revision: "", configurable: false, apps: [] };
type ShellAppsContext = {
  active: boolean; loading: boolean; error: string; snapshot: ShellAppSnapshot;
  refresh: () => Promise<void>;
  mutate: (value: ShellAppChange) => Promise<void>;
};
const Context = createContext<ShellAppsContext>({ active: false, loading: false, error: "", snapshot: EMPTY, refresh: async () => {}, mutate: async () => { throw new Error("Owner access required."); } });
const errors: Record<string, string> = {
  surface_registry_capacity: "The shared app registry is full. Disconnect an unused entry before adding another app.",
  invalid_app_manifest: "This app manifest is unsupported or invalid. Review the file before connecting.",
  app_id_exists: "That app ID is already registered. Choose another ID.",
  app_cookie_scope_conflict: "This address shares MSO's login cookies. Use a different host address, not just a different port.",
  plain_app_url_required: "Use an HTTP or HTTPS address without credentials, query parameters or fragments.",
  surface_registry_changed_reload: "The app list changed. Refresh and review your changes before saving again.",
  surface_registry_managed_by_environment: "This app list is managed by deployment configuration.",
  app_owned_by_another_surface: "This entry belongs to another surface. Use a different app ID.",
};
export function ShellAppsProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!active) return;
    const token = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch("/api/v1/shell-apps", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "Owner access is required." : "Could not load connected apps.");
      const next = await response.json() as ShellAppSnapshot;
      if (next.schemaVersion !== 1 || !Array.isArray(next.apps)) throw new Error("Unsupported app registry version.");
      if (token === generation.current) { setSnapshot(next); setError(""); }
    } catch (reason) {
      if (token === generation.current) { setSnapshot(EMPTY); setError(reason instanceof Error ? reason.message : "Could not load apps."); }
    } finally { if (token === generation.current) setLoading(false); }
  }, [active]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => { void refresh(); });
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { invalidate(); cancelAnimationFrame(frame); clearInterval(poll); window.removeEventListener("focus", focus); };
  }, [active, refresh, invalidate]);
  const mutate = useCallback(async (value: ShellAppChange) => {
    if (!active || !snapshot.configurable) throw new Error("Owner access to a configurable app registry is required.");
    const response = await fetch("/api/v1/shell-apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, schemaVersion: 1, expectedRevision: snapshot.revision, confirm: true }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { if (response.status === 409) await refresh(); throw new Error(errors[data.error ?? ""] ?? "Could not save this app. Check its ID and address."); }
    await refresh();
  }, [active, snapshot, refresh]);
  const value = useMemo(() => ({ active, loading: active && loading, error: active ? error : "", snapshot: active ? snapshot : EMPTY, refresh, mutate }), [active, loading, error, snapshot, refresh, mutate]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useShellApps = () => useContext(Context);
export function useExternalApps(): AppDescriptor[] {
  const { snapshot } = useShellApps();
  const signature = JSON.stringify(snapshot.apps.map(({ id, title }) => ({ id, title })));
  return useMemo(() => (JSON.parse(signature) as Array<{ id: string; title: string }>).map(app => ({
    id: shellAppId(app.id), slug: shellAppId(app.id), title: app.title, icon: Globe,
    gradient: "var(--primary)", prefetch: "never" as const, defaultSize: { w: 1100, h: 720 },
    load: async () => {
      const { default: ExternalApp } = await import("../components/external-app");
      return { default: () => createElement(ExternalApp, { id: app.id }) };
    },
  })), [signature]);
}

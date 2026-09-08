"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useActiveShell } from "../registry/shells";
import type { AppDescriptor } from "./types";

// Apps are injected by the app layer, not imported by os-shell (open/closed).
const RegistryContext = createContext<Map<string, AppDescriptor>>(new Map());

export function AppRegistryProvider({
  apps,
  children,
}: {
  apps: AppDescriptor[];
  children: ReactNode;
}) {
  const map = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  return (
    <RegistryContext.Provider value={map}>{children}</RegistryContext.Provider>
  );
}

export function useApps(): AppDescriptor[] {
  const map = useContext(RegistryContext);
  const { id } = useActiveShell();
  return useMemo(() => Array.from(map.values(), (app) => ({ ...app, title: (id === "macos" || id === "windows" ? app.shellTitles?.[id] : undefined) ?? app.title })), [map, id]);
}

export function useApp(id: string): AppDescriptor | undefined {
  return useContext(RegistryContext).get(id);
}

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Headless mobile navigation state published by a feature and rendered by the
 * active mobile shell. This is deliberately ephemeral: no URL/API/persistence
 * semantics live here. Root navigation needs no publish — the shell defaults to
 * < Home | app title | AI. Drill-down publishes only the parent/title/back action.
 */
export type MobileNavigationInfo = {
  title?: string;
  backLabel?: string;
  onBack?: () => void;
};

type Listener = () => void;
const infos = new Map<string, MobileNavigationInfo>();
const versions = new Map<string, number>();
const listeners = new Set<Listener>();

function bump(appId: string) {
  versions.set(appId, (versions.get(appId) ?? 0) + 1);
  listeners.forEach((listener) => listener());
}

export function publishMobileNavigation(appId: string, info: MobileNavigationInfo): void {
  infos.set(appId, info);
  bump(appId);
}

export function clearMobileNavigation(appId: string): void {
  if (infos.delete(appId)) bump(appId);
}

const store = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  version(appId: string | null | undefined) {
    return appId ? versions.get(appId) ?? 0 : 0;
  },
  get(appId: string | null | undefined) {
    return appId ? infos.get(appId) : undefined;
  },
};

export function useMobileNavigationInfo(appId: string | null | undefined): MobileNavigationInfo | undefined {
  const getSnapshot = useCallback(() => store.version(appId), [appId]);
  useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  return store.get(appId);
}

export function usePublishMobileNavigation(appId: string, info: MobileNavigationInfo | null, deps: unknown[]): void {
  useEffect(() => {
    if (info) publishMobileNavigation(appId, info);
    else clearMobileNavigation(appId);
    return () => clearMobileNavigation(appId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, ...deps]);
}

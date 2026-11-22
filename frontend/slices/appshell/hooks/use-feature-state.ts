"use client";

import { useCallback, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { shellStore } from "../lib/store-state";
import { featureStateKey, readFeatureState, subscribeFeatureState, writeFeatureState } from "../lib/feature-state";

/** Per-window UI state shared by desktop, mobile and dashboard mounts. No disk storage. */
export function useFeatureState<T>(windowId: string | undefined, feature: string, initial: T | (() => T), options?: { sensitive?: boolean }): [T, Dispatch<SetStateAction<T>>] {
  const [fallback, setFallback] = useState(initial);
  const key = featureStateKey(windowId ?? "", feature);
  const subscribe = useCallback((notify: () => void) => subscribeFeatureState(key, notify), [key]);
  const snapshot = useCallback(() => windowId ? readFeatureState(key, fallback) : fallback, [key, windowId, fallback]);
  const serverSnapshot = useCallback(() => fallback, [fallback]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (!windowId) { setFallback(next); return; }
    if (!shellStore.getWindow(windowId)) return;
    const previous = readFeatureState(key, fallback);
    const result = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
    writeFeatureState(key, windowId, result, options?.sensitive === true);
  }, [key, windowId, fallback, options?.sensitive]);
  return [value, setValue];
}

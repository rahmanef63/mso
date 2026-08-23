"use client";

import { useCallback, useEffect, useRef } from "react";

export type AndroidBackLayer = { key: string; onBack: () => void } | null;
const STATE_KEY = "__msoAndroidLayer";

/**
 * Bridges MSO's internal Android navigation to the real Android/browser Back.
 * Each visible internal layer gets a same-URL history entry. Back pops that entry
 * and runs the layer's existing onBack action instead of leaving the site.
 */
export function useAndroidBrowserBack(enabled: boolean, layer: AndroidBackLayer) {
  const layerRef = useRef(layer);
  const suppressNextPush = useRef(false);
  const layerKey = layer?.key ?? null;

  useEffect(() => {
    layerRef.current = layer;
  }, [layer]);

  useEffect(() => {
    if (!enabled) return;
    const onPop = () => {
      const current = layerRef.current;
      if (!current) return;
      suppressNextPush.current = true;
      current.onBack();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (suppressNextPush.current) {
      suppressNextPush.current = false;
      return;
    }
    if (!layerKey) return;

    const state = (window.history.state ?? {}) as Record<string, unknown>;
    const current = state[STATE_KEY];
    if (current === layerKey) return;

    // Launching from All Apps replaces that transient drawer entry with the app
    // entry, so Back goes to Home rather than reopening a drawer the user left.
    if (current === "drawer" && layerKey.startsWith("app:")) {
      window.history.replaceState({ ...state, [STATE_KEY]: layerKey }, "", window.location.href);
      return;
    }
    window.history.pushState({ ...state, [STATE_KEY]: layerKey }, "", window.location.href);
  }, [enabled, layerKey]);

  return useCallback(() => {
    const current = layerRef.current;
    if (!current) return;
    if (!enabled) {
      current.onBack();
      return;
    }
    const marker = (window.history.state as Record<string, unknown> | null)?.[STATE_KEY];
    if (marker === current.key) window.history.back();
    else current.onBack();
  }, [enabled]);
}

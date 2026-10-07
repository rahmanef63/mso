"use client";
import { useEffect } from "react";
import { useSpotlightOpen } from "../../hooks/use-shell";
import { DeferredSurface, loadDeferredSurface } from "../../primitives/deferred-surface";
const load = () => import("./components/spotlight").then((module) => ({ default: module.Spotlight }));
export function DeferredSpotlight() {
  const open = useSpotlightOpen();
  // Warm the Spotlight chunk on idle so the first ⌘K / Search click does not
  // race the dynamic import (UX-04 first-click miss).
  useEffect(() => {
    const warm = () => {
      void loadDeferredSurface(load);
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, 1200);
    return () => window.clearTimeout(t);
  }, []);
  return <DeferredSurface active={open} load={load} label="Search" />;
}

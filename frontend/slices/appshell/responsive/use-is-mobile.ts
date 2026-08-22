"use client";

import * as React from "react";
import { ResponsiveContext } from "./use-responsive";
import { shouldUseMobileSurface } from "./responsive-provider";

// True when the viewport is phone-sized. Inside the shell this reads the single
// <ResponsiveProvider> source of truth; outside it (rare — a standalone preview,
// or a primitive used without the shell) it falls back to its own matchMedia so
// the hook still works. This is appshell-internal: app-chrome and the
// ResponsiveDialog primitive read it instead of reaching to a consumer path.
export function useIsMobile(): boolean {
  const ctx = React.useContext(ResponsiveContext);
  const [fallback, setFallback] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (ctx) return; // provider drives it; no standalone listener needed
    const onChange = () => {
      const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      setFallback(shouldUseMobileSurface("auto", window.innerWidth, window.innerHeight, coarse));
    };
    onChange();
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, [ctx]);

  return ctx ? ctx.isMobile : fallback;
}

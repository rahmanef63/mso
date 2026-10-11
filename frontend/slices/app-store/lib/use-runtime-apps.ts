"use client";

import { useMemo } from "react";
import type { AppDescriptor } from "./host";
import { glyphIcon } from "./glyph";
import { RuntimeApp, type AppManifest } from "../components/runtime-app";
import { useApps } from "./apps-store";

// Retains runtime app metadata so a menu removal never discards an open window.
// Menus use the descriptor's installed flag; all shells share these rows.
export function useRuntimeApps(): AppDescriptor[] {
  const apps = useApps();
  // Stable signature so descriptors (and their lazy components) only change
  // when the underlying app data actually changes — no remount churn.
  const sig = apps
    .map((a) => `${a.appId}:${a.title}:${a.glyph}:${a.gradient}:${a.runtime}:${a.entry}:${a.source}:${a.installed}`)
    .join("|");

  return useMemo(() => {
    return apps.map((a): AppDescriptor => {
      const manifest: AppManifest = {
        title: a.title,
        runtime: a.runtime,
        entry: a.entry,
        source: a.source,
      };
      const Comp = () => RuntimeApp({ manifest });
      Comp.displayName = `Runtime(${a.appId})`;
      return {
        id: a.appId,
        title: a.title,
        installed: a.installed,
        icon: glyphIcon(a.glyph),
        gradient: a.gradient,
        load: () => Promise.resolve({ default: Comp }),
        defaultSize: { w: 640, h: 460 },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}

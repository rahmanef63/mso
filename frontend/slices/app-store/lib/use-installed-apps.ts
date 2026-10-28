"use client";

import { createElement, useMemo } from "react";
import type { AppDescriptor } from "./host";
import { glyphIcon } from "./glyph";
import type { AppManifest } from "../components/runtime-app-types";
import type { AppProps } from "../lib/host";
import { useApps } from "./apps-store";

// `runtime-app` — and through it LegacyHtmlApp, AppConsole and the vaul drawer — is
// imported dynamically, never at module scope. This hook runs in app/os-root.tsx, so a
// static import here pulled that whole subtree into the catch-all's FIRST-LOAD chunk,
// paid by every visitor including one who never installs or opens a runtime app.
//
// The promise is memoised so repeated window opens reuse one chunk fetch and one
// evaluation, which is the contract `descriptor.load()` already promises callers.
let runtimeAppModule: Promise<typeof import("../components/runtime-app")> | null = null;
const loadRuntimeApp = () => (runtimeAppModule ??= import("../components/runtime-app"));

// Turns the owner's installed runtime apps (localStorage) into AppDescriptors
// the shell can mount — merged with the built-in slices by the app layer. This
// is the "dynamic" half of the registry: create/install an app → it appears live.
export function useInstalledApps(): AppDescriptor[] {
  const apps = useApps().filter((a) => a.installed);
  // Stable signature so descriptors (and their lazy components) only change
  // when the underlying app data actually changes — no remount churn.
  const sig = apps
    .map((a) => `${a.appId}:${a.title}:${a.glyph}:${a.gradient}:${a.runtime}:${a.entry}`)
    .join("|");

  return useMemo(() => {
    return apps.map((a): AppDescriptor => {
      const manifest: AppManifest = {
        title: a.title,
        runtime: a.runtime,
        entry: a.entry,
        source: a.source,
      };
      return {
        id: a.appId,
        title: a.title,
        icon: glyphIcon(a.glyph),
        gradient: a.gradient,
        load: async () => {
          const { RuntimeApp } = await loadRuntimeApp();
          // A wrapper, not RuntimeApp itself: the manifest is bound here, so the
          // descriptor's ComponentType<AppProps> signature stays honest. createElement
          // because this module is .ts — JSX is not available here.
          const Comp = (props: AppProps) => createElement(RuntimeApp, { manifest, ...props });
          Comp.displayName = `Runtime(${a.appId})`;
          return { default: Comp };
        },
        defaultSize: { w: 640, h: 460 },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}

"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "../lib/registry";
import { WindowErrorBoundary } from "./window-error-boundary";
import type { AppProps } from "../lib/types";

// Loads an app's lazy bundle into a window. We use a plain useState/useEffect
// loader instead of React.lazy + Suspense on purpose: window opens are driven by
// the synchronous external store (useSyncExternalStore), and a Suspense boundary
// that suspends in that path can miss its retry "ping" — the chunk resolves but
// the fallback only clears on the NEXT render (e.g. when the user clicks the
// window). A setState on import-resolve always re-renders, so the spinner clears
// the instant the module is ready. The import is bundler-cached (and warmed on
// dock hover), so this stays cheap.
export function WindowContent({ app, payload, winId }: { app: string; payload?: unknown; winId?: string }) {
  const descriptor = useApp(app);
  // Keyed by app id: when the window switches app the stale module no longer
  // matches, so `Comp` derives back to null (spinner) without a synchronous
  // setState reset in the effect (react-hooks/set-state-in-effect).
  const [loaded, setLoaded] = useState<{ key: string; Comp: ComponentType<AppProps> } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const Comp = loaded?.key === app ? loaded.Comp : null;

  useEffect(() => {
    if (!descriptor) return;
    let alive = true;
    descriptor
      .load()
      .then((m) => alive && setLoaded({ key: app, Comp: m.default }))
      .catch((e: unknown) => {
        // Show the failure INSTEAD of spinning forever, then rethrow. The rethrow
        // is the point: register-sw.tsx recovers a stale chunk from the global
        // `unhandledrejection` event, and a rejection this catch swallowed never
        // fires it — so the old `.catch(() => {})` left the user on a dead spinner
        // and disabled the one thing that could have fixed it.
        if (alive) setFailed(app);
        throw e;
      });
    return () => {
      alive = false;
    };
  }, [descriptor, app]);

  if (!descriptor) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">App unavailable</p>
          <p className="mt-1 max-w-sm">This app is not installed or is not available for the current session role.</p>
          <p className="mt-2 text-[10px] opacity-70">{app}</p>
        </div>
      </div>
    );
  }

  if (!Comp && failed === app) {
    return (
      <div className="grid h-full place-items-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p>Gagal memuat {descriptor.title}.</p>
        <Button size="sm" variant="secondary" onClick={() => location.reload()}>
          Muat ulang
        </Button>
      </div>
    );
  }

  if (!Comp) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <WindowErrorBoundary key={app} app={app}>
      <Comp payload={payload} winId={winId} />
    </WindowErrorBoundary>
  );
}

"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";

type SurfaceModule = { default: ComponentType };
type SurfaceLoader = () => Promise<SurfaceModule>;
const modules = new WeakMap<SurfaceLoader, Promise<SurfaceModule>>();

export function loadDeferredSurface(load: SurfaceLoader): Promise<SurfaceModule> {
  const cached = modules.get(load);
  if (cached) return cached;
  const pending = Promise.resolve().then(load).catch((error: unknown) => { modules.delete(load); throw error; });
  modules.set(load, pending);
  return pending;
}

/** Keep essential hooks in the caller; defer only presentation until requested.
 * Uses the window host's effect/state pattern: an external-store open must not
 * depend on a Suspense retry ping. Retention preserves tabs and exit animations.
 */
export function DeferredSurface({ active, load, label, keepMounted = false }: {
  active: boolean; load: SurfaceLoader; label: string; keepMounted?: boolean;
}) {
  const [result, setResult] = useState<{ load: SurfaceLoader; Comp?: ComponentType; failed?: boolean } | null>(null);
  const [attempt, retry] = useState(0);
  const current = result?.load === load ? result : null;
  const Comp = current?.Comp;
  useEffect(() => {
    if (!active || Comp) return;
    let alive = true;
    void loadDeferredSurface(load).then((module) => {
      if (alive) setResult({ load, Comp: module.default });
    }).catch((error: unknown) => {
      if (alive) setResult({ load, failed: true });
      // Preserve the global service-worker stale-chunk recovery path.
      throw error;
    });
    return () => { alive = false; };
  }, [active, load, Comp, attempt]);
  if (!active && (!keepMounted || !Comp)) return null;
  if (Comp) return <Comp />;
  if (current?.failed) return <div role="alert" className="p-3 text-sm text-muted-foreground">
    Could not load {label}. <Button variant="secondary" size="sm" onClick={() => retry((value) => value + 1)}>Retry loading {label}</Button>
  </div>;
  return <span role="status" className="sr-only">Loading {label}…</span>;
}

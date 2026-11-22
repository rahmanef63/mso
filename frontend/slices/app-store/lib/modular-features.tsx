"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Blocks } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";
import {
  modularFeatureAppId,
  type ModularFeatureSnapshot,
  type ModularFeatureSummary,
} from "@/lib/contracts/modular-feature";

const EMPTY: ModularFeatureSnapshot = { schemaVersion: 1, features: [] };

type ModularFeaturesContext = {
  active: boolean;
  loading: boolean;
  snapshot: ModularFeatureSnapshot;
  refresh: () => Promise<void>;
};

const Context = createContext<ModularFeaturesContext>({
  active: false,
  loading: false,
  snapshot: EMPTY,
  refresh: async () => {},
});

export function ModularFeaturesProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ModularFeatureSnapshot>(EMPTY);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!active) return;
    const token = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch("/api/v1/features", { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as ModularFeatureSnapshot;
      if (next.schemaVersion === 1 && Array.isArray(next.features) && token === generation.current) {
        setSnapshot(next);
      }
    } catch {
      // Non-fatal: core shell keeps working if modular directory is absent.
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, [active]);

  const invalidate = useCallback(() => {
    generation.current++;
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => { void refresh(); });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      invalidate();
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", onFocus);
    };
  }, [active, refresh, invalidate]);

  const value = useMemo(
    () => ({ active, loading: active && loading, snapshot: active ? snapshot : EMPTY, refresh }),
    [active, loading, snapshot, refresh],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useModularFeatureRegistry = () => useContext(Context);

export function useModularFeatures(): AppDescriptor[] {
  const { snapshot } = useModularFeatureRegistry();
  const signature = JSON.stringify(
    snapshot.features.map((f) => ({ id: f.id, version: f.version, title: f.title, slug: f.slug, entry: f.entry, defaultSize: f.defaultSize })),
  );

  return useMemo(() => {
    const items = JSON.parse(signature) as ModularFeatureSummary[];
    return items.map((feature): AppDescriptor => ({
      id: modularFeatureAppId(feature.id),
      slug: feature.slug ?? modularFeatureAppId(feature.id),
      title: feature.title,
      icon: Blocks,
      gradient: "linear-gradient(160deg,#0ea5e9,#2563eb)",
      prefetch: "never",
      defaultSize: feature.defaultSize ?? { w: 960, h: 660 },
      load: async () => {
        const { default: ModularFeatureApp } = await import("../components/modular-feature-app");
        const Comp = () => createElement(ModularFeatureApp, { feature });
        Comp.displayName = `ModularFeature(${feature.id}@${feature.version})`;
        return { default: Comp };
      },
    }));
  }, [signature]);
}

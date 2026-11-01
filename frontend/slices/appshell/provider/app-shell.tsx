"use client";

import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { OsDesktop } from "../components/desktop";
import { configureWindowTitle, startWindowTitleSync } from "../lib/window-title";
import { useIdleAutoLock } from "../lib/use-idle-auto-lock";
import { AppRegistryProvider } from "../lib/registry";
import { ResponsiveProvider } from "../responsive/responsive-provider";
import { BrandProvider } from "../registry/brand";
import { FeatureRegistryProvider } from "../registry/feature-registry";
import { ShellConfigProvider } from "../registry/shell-config";
import { CapabilitiesProvider, useShellAppearance } from "../registry/capabilities";
import { UrlSync } from "../runtime/use-url-sync";
import type { ShellManifest } from "../registry/types";

// ResponsiveProvider needs the appearance device override, so it mounts via a
// child of CapabilitiesProvider (a plain hoist couldn't call the hook).
function ResponsiveBoundary({ children }: { children: ReactNode }) {
  const { device } = useShellAppearance();
  return <ResponsiveProvider device={device}>{children}</ResponsiveProvider>;
}

function withProviders(
  providers: ComponentType<{ children: ReactNode }>[],
  node: ReactNode,
): ReactNode {
  return providers.reduceRight((acc, P) => <P>{acc}</P>, node);
}

/**
 * THE wrapper provider. A project hands it one manifest (brand + apps +
 * features) and gets the whole desktop+mobile shell. appshell core stays
 * brand- and feature-agnostic: everything specific is injected here. Lifts to
 * rr as the single entry point.
 */
export function AppShell({ manifest }: { manifest: ShellManifest }) {
  const features = manifest.features ?? [];

  // Tab title follows the focused window ("Files — Brand"); audit found it
  // frozen on the SSR metadata.
  useEffect(() => {
    configureWindowTitle({ suffix: manifest.brand.name });
    startWindowTitleSync();
  }, [manifest.brand.name]);

  // Idle auto-lock is armed here, not in the lock-screen component: the component may be
  // deferred for bundle reasons, its protection may not.
  useIdleAutoLock();
  const providers = features
    .map((f) => f.provider)
    .filter((p): p is ComponentType<{ children: ReactNode }> => Boolean(p));
  const shellConfig = useMemo(
    () => ({ persistKey: manifest.persistKey ?? "appshell:layout" }),
    [manifest.persistKey],
  );

  return (
    <CapabilitiesProvider value={manifest.capabilities}>
      <BrandProvider brand={manifest.brand}>
        <ShellConfigProvider value={shellConfig}>
          <FeatureRegistryProvider features={features}>
            {/* Registry + responsive mount ABOVE the feature-provider seam so a
                FeatureDescriptor.provider can call useApps()/useResponsive(). */}
            <AppRegistryProvider apps={manifest.apps}>
              <ResponsiveBoundary>
                <UrlSync apps={manifest.apps} />
                {withProviders(providers, <OsDesktop />)}
              </ResponsiveBoundary>
            </AppRegistryProvider>
          </FeatureRegistryProvider>
        </ShellConfigProvider>
      </BrandProvider>
    </CapabilitiesProvider>
  );
}

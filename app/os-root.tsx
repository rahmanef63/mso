"use client";

import { useMemo } from "react";
import { AppShell, type ShellManifest } from "@/features/appshell";
import {
  A11yCommands,
  TOPSIDE_BRAND,
  TOPSIDE_FEATURES,
  TOPSIDE_PERSIST_KEY,
  BUILTIN_APPS,
  topsideCapabilities,
  OsApiProvider,
} from "@/features/os-shell";
import { AppearanceProvider } from "@/lib/appearance";
import { QuicklinksProvider } from "@/lib/quicklinks";
import "@/features/os-shell/integrations";

import { AuthGate, SessionProvider, useSession, type DeviceRole, type SessionStatus } from "@/features/auth";
import { appAllowedForRole } from "@/lib/auth/app-access";
import { useInstalledApps, useDisabledIds } from "@/features/app-store";

function Shell() {
  const dynamic = useInstalledApps();
  const disabled = useDisabledIds();
  const { status, role } = useSession();
  const manifest: ShellManifest = useMemo(() => {
    const off = new Set(disabled);
    const all = [...BUILTIN_APPS, ...dynamic].filter((app) => !off.has(app.id));
    // Signed-out is the unrestricted mock showcase. A live delegated session sees
    // only apps its role can actually use; unknown runtime apps fail closed for
    // non-owners because their host contract cannot be inferred safely.
    const apps = status === "in" ? all.filter((app) => appAllowedForRole(app.id, role)) : all;
    const ordered = status === "out"
      ? [
          ...apps.filter((app) => app.id === "docs").map((app) => ({ ...app, pinned: true })),
          ...apps.filter((app) => app.id !== "docs"),
        ]
      : apps;
    return {
      brand: TOPSIDE_BRAND,
      apps: ordered,
      features: TOPSIDE_FEATURES.filter((feature) => !off.has(feature.id)),
      persistKey: TOPSIDE_PERSIST_KEY,
      capabilities: topsideCapabilities,
    };
  }, [dynamic, disabled, status, role]);
  return <AppShell manifest={manifest} />;
}

export function OsRoot({
  initialStatus,
  initialRole,
}: {
  initialStatus?: SessionStatus;
  initialRole?: DeviceRole | null;
}) {
  return (
    <AppearanceProvider>
      <QuicklinksProvider>
        <A11yCommands />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[var(--z-skip-link)] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background focus:outline-2 focus:outline-ring"
        >
          Skip to main content
        </a>
        <SessionProvider initialStatus={initialStatus} initialRole={initialRole}>
          <AuthGate>
            <OsApiProvider>
              <Shell />
            </OsApiProvider>
          </AuthGate>
        </SessionProvider>
      </QuicklinksProvider>
    </AppearanceProvider>
  );
}

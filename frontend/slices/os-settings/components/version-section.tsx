"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsActionRow, SettingsBlock, SettingsSection, SettingsValueRow } from "@/features/shell-settings";
import pkg from "../../../../package.json";

type HealthIdentity = {
  status?: string;
  version?: string;
  buildId?: string;
  buildSha?: string | null;
};

const fallback = (): HealthIdentity => ({
  status: "unknown",
  version: pkg.version ?? "0.0.0",
  buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
  buildSha: process.env.NEXT_PUBLIC_COMMIT_SHA || null,
});

export function VersionSection({ onCheckUpdates }: { onCheckUpdates: () => void }) {
  const [health, setHealth] = useState<HealthIdentity | null>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((body: HealthIdentity) => {
        if (alive) setHealth(body);
      })
      .catch(() => {
        if (!alive) return;
        setLive(false);
        setHealth(fallback());
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!health) {
    return (
      <SettingsSection icon={<Info />} title="Version" footnote="Reading /api/health.">
        <SettingsBlock className="space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </SettingsBlock>
      </SettingsSection>
    );
  }

  const buildSha = health.buildSha || "not set";
  return (
    <SettingsSection
      icon={<Info />}
      title="Version"
      footnote={live
        ? "Same identity /api/health reports for this running server."
        : "Showing the build identity baked into this page because /api/health did not respond."}
    >
      {!live ? (
        <SettingsBlock>
          <p role="alert" className="text-sm text-destructive-text">Version details from the server are unavailable.</p>
        </SettingsBlock>
      ) : null}
      <SettingsValueRow label="Status" value={health.status || "unknown"} />
      <SettingsValueRow label="App version" value={health.version || pkg.version || "0.0.0"} />
      <SettingsValueRow label="Build ID" value={health.buildId || "dev"} />
      <SettingsValueRow label="Build SHA" value={buildSha} />
      <SettingsActionRow label="Check software updates" icon={<Info />} onClick={onCheckUpdates} />
    </SettingsSection>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Loader2, RefreshCw, ServerCog, Settings2 } from "lucide-react";
import type { AppProps } from "@/features/appshell";
import { AppFrame } from "@/features/appshell";
import { loadManagedAppsSurface } from "@/features/managed-apps";
import type { DiscoveredLocalApp, LocalDiscoverySnapshot } from "@/lib/contracts/app-discovery";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import type { ManagedAppId, ManagedAppView } from "@/lib/managed-apps/types";
import { Button } from "@/components/ui/button";
import { N8nMark } from "./components/n8n-connect-panel";
import { N8nEmbedPanel } from "./components/n8n-embed-panel";
import { N8nSetupWizard } from "./components/n8n-setup-wizard";

type EmbedResponse = { apps?: WorkflowEmbed[]; revision?: string; configurable?: boolean };
type ViewMode = "auto" | "managed" | "setup";

export default function N8nApp(_: AppProps) {
  const [apps, setApps] = useState<WorkflowEmbed[]>([]);
  const [managed, setManaged] = useState<ManagedAppView | null>(null);
  const [detected, setDetected] = useState<DiscoveredLocalApp | null>(null);
  const [revision, setRevision] = useState("");
  const [configurable, setConfigurable] = useState(true);
  const [settled, setSettled] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("auto");
  const [ManagedSurface, setManagedSurface] = useState<ComponentType<{ focus: ManagedAppId; initialDetails?: boolean }> | null>(null);

  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const [embedRes, mappRes, discoverRes] = await Promise.all([
        fetch("/api/v1/workflow-embeds", { cache: "no-store", signal: controller.signal }),
        fetch("/api/v1/managed-apps/n8n", { cache: "no-store", signal: controller.signal }).catch(() => null),
        fetch("/api/v1/managed-apps/discover", { cache: "no-store", signal: controller.signal }).catch(() => null),
      ]);
      if (controller.signal.aborted) return;
      if (mappRes?.ok) {
        const payload = (await mappRes.json()) as { app?: ManagedAppView };
        if (payload.app) setManaged(payload.app);
      }
      if (discoverRes?.ok) {
        const payload = (await discoverRes.json()) as LocalDiscoverySnapshot;
        setDetected(payload.apps.find((a) => a.id === "n8n") ?? null);
      }
      if (!embedRes.ok) {
        setApps([]);
        setForbidden(embedRes.status === 403 && !mappRes?.ok);
        setMessage(embedRes.status === 403 ? "Owner access is required to edit the n8n connection." : "Could not load the n8n surface.");
        return;
      }
      const data = (await embedRes.json()) as EmbedResponse;
      if (controller.signal.aborted) return;
      setApps(Array.isArray(data.apps) ? data.apps : []);
      setRevision(typeof data.revision === "string" ? data.revision : "");
      setConfigurable(data.configurable !== false);
      setForbidden(false);
      setMessage("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : "Could not load the n8n surface.");
    } finally {
      if (!controller.signal.aborted) setSettled(true);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load(); });
    window.addEventListener("focus", load);
    return () => {
      request.current?.abort();
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const n8n = useMemo(
    () => apps.find((app) => app.id === "n8n" || app.title.trim().toLowerCase() === "n8n") ?? null,
    [apps],
  );

  const handleSaved = useCallback(async () => {
    await load();
    setViewMode("auto");
  }, [load]);

  const managedInstalled = Boolean(managed?.installed);
  const showManaged = viewMode === "managed" || (viewMode === "auto" && managedInstalled && !n8n);
  const showSetup = viewMode === "setup" || (viewMode === "auto" && !n8n && !managedInstalled);

  useEffect(() => {
    if (!showManaged || ManagedSurface) return;
    let active = true;
    void loadManagedAppsSurface().then((Component) => {
      if (active) setManagedSurface(() => Component);
    });
    return () => { active = false; };
  }, [showManaged, ManagedSurface]);

  const embedActions = (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setViewMode("managed")} title="Install, update, or control local n8n">
        <ServerCog className="size-3.5" aria-hidden />
        <span>{managedInstalled ? "Local runtime" : "Manage local"}</span>
      </Button>
      <Button type="button" size={n8n?.blocked || !n8n?.url ? "sm" : "icon"} variant={n8n?.blocked || !n8n?.url ? "outline" : "ghost"} onClick={() => setViewMode("setup")} aria-label="n8n connection settings" title="Connection settings">
        <Settings2 className="size-4" aria-hidden />
        {n8n?.blocked || !n8n?.url ? <span>Update n8n connection</span> : null}
      </Button>
    </>
  );

  return (
    <div data-slot="n8n-feature" className="@container h-full min-h-0 min-w-0">
      <AppFrame safeArea={false} className="h-full min-w-0" bodyClassName="overflow-hidden">
        {!settled && !n8n && !managed ? (
          <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading n8n...
          </div>
        ) : forbidden && !n8n && !managed ? (
          <div className="flex h-full items-center justify-center overflow-y-auto p-6">
            <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
              <N8nMark className="size-10 rounded-xl object-contain" />
              <div className="space-y-1">
                <h2 className="text-base font-semibold">n8n</h2>
                <p role="alert" className="text-xs leading-relaxed text-muted-foreground">{message}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                <RefreshCw className="size-3.5" aria-hidden /> Try again
              </Button>
            </div>
          </div>
        ) : showManaged ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-xs">
              <span className="truncate text-muted-foreground">MSO managed n8n (Docker on loopback 5678)</span>
              <div className="flex items-center gap-1.5">
                {n8n && (
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setViewMode("auto")}>
                    External URL
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setViewMode("setup")}>
                  <Settings2 className="size-3.5" aria-hidden /> Connect / SSH
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {ManagedSurface ? (
                <ManagedSurface focus="n8n" />
              ) : (
                <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading n8n runtime controls...
                </div>
              )}
            </div>
          </div>
        ) : showSetup ? (
          <N8nSetupWizard
            key={n8n ? `${n8n.origin}:${n8n.url ?? ""}:${n8n.renderer}` : "setup"}
            existing={n8n}
            detected={detected}
            configurable={configurable}
            revision={revision}
            loadMessage={message}
            onSaved={handleSaved}
            onRefresh={() => void load()}
            onOpenManaged={() => setViewMode("managed")}
            onClose={n8n || managedInstalled ? () => setViewMode("auto") : undefined}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {message ? (
              <p role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive-text">
                Refresh failed. Showing the last loaded surface. {message}
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
              <N8nEmbedPanel app={n8n!} actions={embedActions} />
            </div>
          </div>
        )}
      </AppFrame>
    </div>
  );
}

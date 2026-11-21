"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Settings2 } from "lucide-react";
import type { AppProps } from "@/features/appshell";
import { AppFrame } from "@/features/appshell";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { Button } from "@/components/ui/button";
import { N8nConnectPanel, N8nMark } from "./components/n8n-connect-panel";
import { N8nEmbedPanel } from "./components/n8n-embed-panel";

type EmbedResponse = {
  apps?: WorkflowEmbed[];
  revision?: string;
  configurable?: boolean;
};

export default function N8nApp(_: AppProps) {
  const [apps, setApps] = useState<WorkflowEmbed[]>([]);
  const [revision, setRevision] = useState("");
  const [configurable, setConfigurable] = useState(true);
  const [settled, setSettled] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/v1/workflow-embeds", { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setApps([]);
        setForbidden(response.status === 403);
        setMessage(
          response.status === 403
            ? "Owner access is required to view the reviewed n8n surface."
            : "Could not load the n8n surface.",
        );
        return;
      }
      const data = await response.json() as EmbedResponse;
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
    setSettingsOpen(false);
  }, [load]);

  const settingsButton = n8n?.blocked || !n8n?.url ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setSettingsOpen(true)}
    >
      <Settings2 className="size-4" aria-hidden /> Update n8n connection
    </Button>
  ) : (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={() => setSettingsOpen(true)}
      aria-label="n8n connection settings"
      title="Connection settings"
    >
      <Settings2 className="size-4" />
    </Button>
  );

  return (
    <div data-slot="n8n-feature" className="@container h-full min-h-0 min-w-0">
      <AppFrame safeArea={false} className="h-full min-w-0" bodyClassName="overflow-hidden">
        {!settled && !n8n ? (
          <div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading n8n…
          </div>
        ) : forbidden && !n8n ? (
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
        ) : !n8n || settingsOpen ? (
          <N8nConnectPanel
            key={n8n ? `${n8n.origin}:${n8n.url ?? ""}:${n8n.renderer}:${n8n.loginUrl ?? ""}` : "empty"}
            existing={n8n}
            configurable={configurable}
            revision={revision}
            loadMessage={message}
            onSaved={handleSaved}
            onRefresh={() => void load()}
            onClose={n8n ? () => setSettingsOpen(false) : undefined}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {message ? (
              <p role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive-text">
                Refresh failed. Showing the last loaded surface. {message}
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
              <N8nEmbedPanel app={n8n} actions={settingsButton} />
            </div>
          </div>
        )}
      </AppFrame>
    </div>
  );
}

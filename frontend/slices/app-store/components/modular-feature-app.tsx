"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { AppFrame } from "@/features/appshell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ModularFeatureSummary } from "@/lib/contracts/modular-feature";

export default function ModularFeatureApp({ feature }: { feature: ModularFeatureSummary }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const src = `/api/v1/features/${encodeURIComponent(feature.id)}/asset/${feature.entry}?v=${encodeURIComponent(feature.version)}&r=${reloadKey}`;

  const toolbar = (
    <div className="flex h-10 min-w-0 items-center justify-between gap-2 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs font-semibold">{feature.title}</span>
        <Badge variant="outline" className="text-[10px]">v{feature.version}</Badge>
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Reload ${feature.title}`}
        title="Reload modular feature"
        onClick={() => {
          setStatus("loading");
          setReloadKey((n) => n + 1);
        }}
      >
        <RefreshCw className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <AppFrame safeArea={false} className="h-full min-w-0 bg-background" toolbar={toolbar} bodyClassName="overflow-hidden">
      <div className="relative flex h-full min-h-0 flex-col">
        {status !== "ready" && (
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <span role={status === "error" ? "alert" : "status"}>
              {status === "error"
                ? `Could not load ${feature.title}.`
                : `Loading ${feature.title} v${feature.version}...`}
            </span>
            {status === "error" && (
              <Button size="sm" variant="secondary" onClick={() => { setStatus("loading"); setReloadKey((n) => n + 1); }}>
                Retry
              </Button>
            )}
          </div>
        )}
        <iframe
          key={`${feature.version}:${reloadKey}`}
          src={src}
          title={feature.title}
          sandbox="allow-scripts allow-forms allow-downloads allow-same-origin"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-background"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
      </div>
    </AppFrame>
  );
}

"use client";

import { createElement, useState } from "react";
import { Check, Download, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { glyphIcon } from "../lib/glyph";
import type { CatalogApp } from "../lib/store-catalog";
import { useContextZone, openWindow } from "@/features/appshell";
import type { MenuItem } from "@/features/appshell";

// One app row in the store grid. Icon comes from the shared glyph map so it
// matches the dock/launchpad icon once installed. The Get button flips the
// Convex row to installed=true; once installed it becomes an Uninstall toggle
// (hover-revealed) — live state is driven by the merged catalog prop.
export function StoreAppCard({
  app,
  onToggle,
}: {
  app: CatalogApp;
  onToggle: (app: CatalogApp) => void;
}) {
  const [hover, setHover] = useState(false);
  // Right-click this card → these items, which NEST under the store's list zone
  // + (once migrated) the window + shell. This is the whole "any feature adds
  // right-click in a few lines" contract: one hook, one ref, no portal/state.
  const zone = useContextZone((): MenuItem[] =>
    app.installed
      ? [
          { label: "Open", icon: ExternalLink, onClick: () => openWindow(app.appId, app.title) },
          { type: "sep" },
          { label: "Uninstall", icon: Trash2, danger: true, onClick: () => onToggle(app) },
        ]
      : [{ label: `Install ${app.title}`, icon: Download, onClick: () => onToggle(app) }],
  );

  return (
    <Card
      ref={zone}
      className="flex gap-3 p-3.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="relative grid size-12 shrink-0 place-items-center rounded-xl text-white shadow-sm"
        style={{ background: app.gradient }}
      >
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.30),rgba(255,255,255,0.06)_45%,rgba(0,0,0,0.06))]" />
        {/* createElement: dynamic stateless lookup, not a render-created component */}
        {createElement(glyphIcon(app.glyph), { className: "relative size-6" })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              {app.title}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge variant="outline">{app.category}</Badge>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {app.runtime}
              </Badge>
            </div>
          </div>
          <Button
            size="sm"
            variant={app.installed ? "secondary" : "default"}
            onClick={() => onToggle(app)}
            className={cn(
              "shrink-0 [@media(pointer:coarse)]:min-h-[44px]",
              app.installed && "text-muted-foreground",
            )}
          >
            {app.installed ? (
              hover ? (
                <>
                  <Trash2 /> Uninstall
                </>
              ) : (
                <>
                  <Check /> Installed
                </>
              )
            ) : (
              <>
                <Download /> Get
              </>
            )}
          </Button>
        </div>
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {app.desc}
        </p>
      </div>
    </Card>
  );
}

"use client";

import { createElement } from "react";
import { Check, Download, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { glyphIcon } from "../lib/glyph";
import type { CatalogApp } from "../lib/store-catalog";
import { useContextZone, openWindow } from "@/features/appshell";
import type { MenuItem } from "@/features/appshell";
import { StoreTile } from "./store-tile";

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
  // Right-click this card → these items, which NEST under the store's list zone
  // + (once migrated) the window + shell. This is the whole "any feature adds
  // right-click in a few lines" contract: one hook, one ref, no portal/state.
  // Installed rows get two groups (open, then the destructive one).
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
    <StoreTile
      cardRef={zone}
      title={app.title}
      gradient={app.gradient}
      desc={app.desc}
      overlay="gloss"
      glyph={
        // createElement: dynamic stateless lookup, not a render-created component
        createElement(glyphIcon(app.glyph), { className: "relative size-6" })
      }
      meta={
        <div className="mt-1 flex items-center gap-1.5">
          <Badge variant="outline">{app.category}</Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {app.runtime}
          </Badge>
        </div>
      }
      action={(hover) => (
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
      )}
    />
  );
}

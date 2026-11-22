"use client";

import { Check, Download, Trash2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SystemEntry } from "../lib/system-catalog";
import { StoreTile } from "./store-tile";

// A built-in app / shell feature row — same chrome + Install/Installed/Uninstall
// verbs as StoreAppCard, so the OS's own pieces read as optional installs too.
// Installed + hover reveals "Uninstall". Required entries (App Store) lock on.
export function SystemCard({
  entry,
  installed,
  onToggle,
}: {
  entry: SystemEntry;
  installed: boolean;
  onToggle: (entry: SystemEntry) => void;
}) {
  const Icon = entry.icon;
  const locked = entry.required;

  return (
    <StoreTile
      title={entry.title}
      gradient={entry.gradient}
      desc={entry.desc}
      overlay="sheen"
      glyph={
        entry.artwork ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.artwork}
            alt=""
            aria-hidden
            className="relative size-7 object-contain"
            draggable={false}
            decoding="async"
          />
        ) : (
          <Icon className="relative size-6" />
        )
      }
      meta={
        <div className="mt-1">
          <Badge variant="outline">
            {entry.kind === "app" ? "App" : "System Feature"}
          </Badge>
        </div>
      }
      action={(hover) => (
        <Button
          size="sm"
          variant={installed ? "secondary" : "default"}
          disabled={locked}
          onClick={() => onToggle(entry)}
          className={cn("shrink-0", installed && "text-muted-foreground")}
        >
          {locked ? (
            <>
              <Lock /> Required
            </>
          ) : installed ? (
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
              <Download /> Install
            </>
          )}
        </Button>
      )}
    />
  );
}

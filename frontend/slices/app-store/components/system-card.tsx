"use client";

import { useState } from "react";
import { Check, Download, Trash2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SystemEntry } from "../lib/system-catalog";

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
  const [hover, setHover] = useState(false);
  const locked = entry.required;

  return (
    <Card
      className="flex gap-3 p-3.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="relative grid size-12 shrink-0 place-items-center rounded-xl text-white shadow-sm"
        style={{ background: entry.gradient }}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-white/20" />
        {entry.artwork ? (
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
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              {entry.title}
            </div>
            <div className="mt-1">
              <Badge variant="outline">
                {entry.kind === "app" ? "App" : "System Feature"}
              </Badge>
            </div>
          </div>
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
        </div>
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {entry.desc}
        </p>
      </div>
    </Card>
  );
}

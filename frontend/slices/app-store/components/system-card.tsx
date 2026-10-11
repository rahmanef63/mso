"use client";

import { useState } from "react";
import { Check, Download, Trash2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/features/appshell";
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
  const [hover, setHover] = useState(false);
  const locked = entry.required;

  return (
    <Card role="article" aria-label={`${entry.title} ${entry.kind}`}
      className="flex gap-3 p-3.5"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="size-12 shrink-0"><AppIcon app={entry} /></div>

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

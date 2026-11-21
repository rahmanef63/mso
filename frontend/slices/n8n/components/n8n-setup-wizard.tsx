"use client";

import { useState } from "react";
import { Globe, HardDrive, KeyRound, RefreshCw, X } from "lucide-react";
import type { DiscoveredLocalApp } from "@/lib/contracts/app-discovery";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { Button } from "@/components/ui/button";
import { N8nConnectPanel, N8nMark } from "./n8n-connect-panel";
import { N8nLocalPanel } from "./n8n-local-panel";
import { N8nSshPanel } from "./n8n-ssh-panel";

type SetupMode = "local" | "https" | "ssh";

export function N8nSetupWizard({
  existing,
  detected,
  configurable,
  revision,
  loadMessage,
  initialMode,
  onSaved,
  onRefresh,
  onOpenManaged,
  onClose,
}: {
  existing: WorkflowEmbed | null;
  detected: DiscoveredLocalApp | null;
  configurable: boolean;
  revision: string;
  loadMessage: string;
  initialMode?: SetupMode;
  onSaved: () => Promise<void>;
  onRefresh: () => void;
  onOpenManaged: () => void;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<SetupMode>(initialMode ?? "https");

  if (mode === "https") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <ModeTabs mode={mode} onChange={setMode} onRefresh={onRefresh} onClose={onClose} />
        <div className="min-h-0 flex-1">
          <N8nConnectPanel
            existing={existing}
            configurable={configurable}
            revision={revision}
            loadMessage={loadMessage}
            onSaved={onSaved}
            onRefresh={onRefresh}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <ModeTabs mode={mode} onChange={setMode} onRefresh={onRefresh} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 px-6 py-8 text-center">
          <N8nMark className="size-10 rounded-xl object-contain" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Set up n8n</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              n8n runs outside MSO. Install it locally with MSO, point to an existing local copy, or connect a remote server.
            </p>
          </div>
          <div className="w-full">
            {mode === "local" ? (
              <N8nLocalPanel detected={detected} onOpenManaged={onOpenManaged} />
            ) : (
              <N8nSshPanel />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeTabs({
  mode,
  onChange,
  onRefresh,
  onClose,
}: {
  mode: SetupMode;
  onChange: (next: SetupMode) => void;
  onRefresh: () => void;
  onClose?: () => void;
}) {
  const tabs: Array<{ id: SetupMode; label: string; icon: typeof HardDrive }> = [
    { id: "local", label: "This computer", icon: HardDrive },
    { id: "https", label: "HTTPS URL", icon: Globe },
    { id: "ssh", label: "Remote SSH", icon: KeyRound },
  ];
  return (
    <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
      <div className="flex flex-1 flex-wrap items-center gap-1" role="tablist" aria-label="n8n connection mode">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = mode === tab.id;
          return (
            <Button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              size="sm"
              variant={active ? "secondary" : "ghost"}
              onClick={() => onChange(tab.id)}
              className="h-7 px-2.5 text-xs"
            >
              <Icon className="size-3.5" aria-hidden />
              {tab.label}
            </Button>
          );
        })}
      </div>
      <Button type="button" size="icon" variant="ghost" onClick={onRefresh} aria-label="Refresh n8n status" title="Refresh n8n status">
        <RefreshCw className="size-3.5" />
      </Button>
      {onClose && (
        <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Close n8n settings" title="Close n8n settings">
          <X className="size-3.5" />
        </Button>
      )}
    </header>
  );
}

"use client";

import { useState } from "react";
import { ChevronDown, Download, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton, copyClip, openWindow, toast } from "@/features/appshell";
import { providersFor } from "@/lib/managed-apps/providers";
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { AppDeckPreflightCard } from "./appdeck-preflight-card";
import { supportFor } from "./app-support";
import { installApp } from "./update-api";
import { isActive } from "./update-machine";
import type { UpdateCentre } from "./use-update-center";

export function InstallPanel({
  appId,
  command,
  centre,
}: {
  appId: ManagedAppId;
  command?: string | null;
  centre: UpdateCentre;
}) {
  const support = supportFor(appId);
  const providers = providersFor(appId);
  const [provider, setProvider] = useState(providers[0]?.id ?? "");
  const [apiKey, setApiKey] = useState("");
  const [open, setOpen] = useState(false);
  const [preflightReady, setPreflightReady] = useState(true);
  const install = command ?? support.installCommand;
  const busy = isActive(centre.job.phase);

  const start = () => {
    const key = apiKey.trim();
    setApiKey("");
    void centre.run("install", () => installApp(appId, key ? { provider, apiKey: key } : {}));
  };

  const openTerminal = async () => {
    const copied = await (copyClip(install) as unknown as Promise<boolean | void>);
    if (copied === false) return;
    openWindow("os-terminal", "Terminal");
    toast("Command copied. Paste it in the Terminal");
  };

  return (
    <div className="space-y-3">
      <AppDeckPreflightCard appId={appId} onReadyChange={setPreflightReady} />

      <Button type="button" size="lg" className="w-full" disabled={busy || !preflightReady} onClick={start}>
        <Download aria-hidden />
        {busy ? `Installing ${appId}...` : `Install ${appId} with AppDeck`}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        AppDeck downloads the verified release, configures it safely on your server, and waits until it is healthy.{" "}
        {appId === "hermes" ? "Hermes prepares its runtime first, so give it several minutes." : "Usually ready in under a minute."}
      </p>

      {providers.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-2">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left text-[11px] font-medium text-muted-foreground"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            <ChevronDown className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
            Add a model provider now (optional)
          </button>

          {open && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                You can skip this and add a provider later inside the app. Adding one here just saves a step.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`install-provider-${appId}`} className="text-xs">
                    Provider
                  </Label>
                  <select
                    id={`install-provider-${appId}`}
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {providers.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <Label htmlFor={`install-key-${appId}`} className="text-xs">
                    API key
                  </Label>
                  <Input
                    id={`install-key-${appId}`}
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-..."
                    aria-describedby={`install-key-${appId}-hint`}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </div>
              <p id={`install-key-${appId}-hint`} className="text-[11px] leading-relaxed text-muted-foreground">
                Passed directly to the installer environment once. Not stored by MSO and never written to logs.
              </p>
            </div>
          )}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">Advanced: install from terminal</summary>
        <div className="space-y-2 pt-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{support.installNote}</p>
          <div className="flex items-start gap-2 rounded-md border border-border bg-secondary p-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-secondary-foreground">{install}</code>
            <CopyButton value={install} label="install command" />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void openTerminal()}>
            <SquareTerminal aria-hidden />
            Open in Terminal
          </Button>
        </div>
      </details>
    </div>
  );
}

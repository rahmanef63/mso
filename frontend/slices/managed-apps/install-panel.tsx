"use client";

import { useState } from "react";
import { ChevronDown, Download, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton, copyClip, openWindow, toast } from "@/features/appshell";
import { providersFor } from "@/lib/managed-apps/providers";
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { supportFor } from "./app-support";
import { installApp } from "./update-api";
import { isActive } from "./update-machine";
import type { UpdateCentre } from "./use-update-center";

// Install used to be a command to copy, because both upstream installers asked
// questions. They stopped: `hermes setup --non-interactive` reads its answers
// from the environment, and `openclaw onboard --non-interactive` exists behind
// an `--accept-risk` acknowledgement. So this is a real button now, running
// scripts/managed-app-install through the same job machinery as update — the
// transcript streams into the panel the update flow already renders.
//
// The API key is OPTIONAL and that is the point: an install that demands a
// credential before it will start is not one click, and a gateway with no
// provider still installs, still starts, and still says what it is missing.
// It is held in component state only until the request resolves, then dropped —
// never put in a URL, never echoed back by the route, never in the job argv.
//
// The command stays on screen. A button that fails on someone's machine and
// leaves them with nothing is worse than the copy-paste it replaced.
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
  const install = command ?? support.installCommand;
  const busy = isActive(centre.job.phase);

  const start = () => {
    const key = apiKey.trim();
    setApiKey(""); // out of React state the moment it is handed over
    void centre.run("install", () => installApp(appId, key ? { provider, apiKey: key } : {}));
  };

  const openTerminal = () => {
    copyClip(install);
    openWindow("os-terminal", "Terminal");
    toast("Command copied — paste it in the Terminal");
  };

  return (
    <div className="space-y-3">
      {/* One line, not a paragraph. The surface around this already names the app and says
          it is absent; what the operator needs here is the button and how long it takes. */}
      <Button type="button" size="lg" className="w-full" disabled={busy} onClick={start}>
        <Download aria-hidden />
        {busy ? `Installing ${appId}…` : `Install ${appId}`}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Runs the upstream installer on the server and starts the service. Progress appears below;{" "}
        {appId === "hermes" ? "Hermes fetches a Python toolchain first, so give it several minutes" : "usually under a minute"}.
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
                Skip this and it installs without one — the app comes up and tells you it needs a provider,
                and you can add one from its own settings. Supplying it here just saves that round trip.
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
                    placeholder="sk-…"
                    aria-describedby={`install-key-${appId}-hint`}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </div>
              <p id={`install-key-${appId}-hint`} className="text-[11px] leading-relaxed text-muted-foreground">
                Sent once, in the request body, and handed to the installer through its environment — it is
                not stored by MSO and never appears in the install transcript or the audit log.
              </p>
            </div>
          )}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">Or install it by hand</summary>
        <div className="space-y-2 pt-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{support.installNote}</p>
          <div className="flex items-start gap-2 rounded-md border border-border bg-secondary p-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-secondary-foreground">{install}</code>
            <CopyButton value={install} label="install command" />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={openTerminal}>
            <SquareTerminal aria-hidden />
            Open in Terminal
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Once it is installed and its service is up, this card picks it up on the next refresh — detection
            reads systemd, then docker, then the CLI on PATH.
          </p>
        </div>
      </details>
    </div>
  );
}

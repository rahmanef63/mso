"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Native install affordance. Chromium fires `beforeinstallprompt` when the PWA
// is installable; we stash it and show a one-tap "Install" pill (browsers
// otherwise bury the action in a menu). iOS Safari has no such event — it uses
// Share → Add to Home Screen, so nothing renders there. Dismiss is per-session.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so we can trigger it from our own UI
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!evt || hidden) return null;

  const install = async () => {
    await evt.prompt();
    await evt.userChoice.catch(() => undefined);
    setEvt(null);
  };

  return (
    <div data-slot="pwa-install-prompt" className="pointer-events-none fixed inset-x-0 z-[var(--z-spotlight)] flex justify-center px-4" style={{ bottom: "calc(8.5rem + var(--sai-bottom, 0px))" }}>
      <div className="glass pointer-events-auto flex items-center gap-2 rounded-2xl border border-border bg-card/90 px-3 py-2 shadow-[var(--shadow-win)]">
        <Download className="size-4 shrink-0 text-primary" />
        <span className="text-sm">Install Manef Shell OS as an app</span>
        <Button type="button" size="sm" onClick={install} className="ml-1">
          Install
        </Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Dismiss" onClick={() => setHidden(true)}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

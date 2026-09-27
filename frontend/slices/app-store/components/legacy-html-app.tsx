"use client";
import { openWindow } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { useShellApps } from "../lib/shell-apps";
import ExternalApp from "./external-app";
import type { AppManifest } from "./runtime-app-types";

export function LegacyHtmlApp({ manifest }: { manifest: AppManifest }) {
  const { snapshot } = useShellApps();
  let url = "";
  try { url = new URL(manifest.entry).href; } catch { /* Invalid legacy data never grants framing. */ }
  const app = snapshot.apps.find(entry => entry.definition.url === url);
  if (app) return <ExternalApp id={app.id}/>;
  return <div className="grid h-full place-items-center p-6"><div className="max-w-md space-y-3 text-center">
    <h2 className="font-semibold">Connect {manifest.title}</h2>
    <p className="text-sm text-muted-foreground">This browser-only entry needs a reviewed connection before it can be embedded. Open App Store and connect the running application.</p>
    <Button onClick={() => openWindow("app-store", "App Store")}>Open App Store</Button>
  </div></div>;
}

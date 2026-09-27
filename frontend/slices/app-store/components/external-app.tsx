"use client";
import { ExternalAppFrame } from "@/components/external-app-frame";
import { useShellApps } from "../lib/shell-apps";

export default function ExternalApp({ id }: { id: string }) {
  const { snapshot, error, loading } = useShellApps();
  const app = snapshot.apps.find(entry => entry.id === id);
  if (!app) return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground" role="status">{loading ? "Loading app…" : error || "This app was disconnected or is no longer available. Open App Store to reconnect it."}</div>;
  return <ExternalAppFrame key={`${app.id}:${app.url}:${app.sandbox}`} app={app} />;
}

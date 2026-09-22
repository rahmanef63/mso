"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LogIn, RefreshCw } from "lucide-react";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
import { Button } from "@/components/ui/button";

export function N8nEmbedPanel({ app }: { app: WorkflowEmbed }) {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [revision]);
  if (app.blocked || !app.url) return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm" data-slot="n8n-embed-panel" role="alert">
    <p>{app.reason || "This editor destination is unavailable."}</p>
    <p className="text-xs text-muted-foreground">No editor or login link is opened. Configure a separate cookie-isolated origin before connecting.</p>
  </div>;
  const reload = () => { setLoading(true); setSlow(false); setRevision((value) => value + 1); };
  return <div className="flex h-full min-h-0 min-w-0 flex-col" data-slot="n8n-embed-panel">
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={app.origin}>{app.origin}</span>
      {app.loginUrl ? <Button asChild variant="ghost" size="sm"><a href={app.loginUrl} target="_blank" rel="noopener noreferrer"><LogIn className="size-4"/><span>Sign in</span></a></Button> : null}
      <Button asChild variant="outline" size="sm"><a href={app.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4"/><span>Open {app.title}</span></a></Button>
      {app.renderer === "iframe" ? <Button variant="ghost" size="icon" onClick={reload} aria-label={`Reload ${app.title}`} title={`Reload ${app.title}`}><RefreshCw className="size-4"/></Button> : null}
    </div>
    {app.renderer === "iframe" ? <div className="relative min-h-0 min-w-0 flex-1">
      {loading ? <div className="absolute inset-x-0 top-0 z-10 border-b bg-background px-3 py-2 text-xs text-muted-foreground" role="status">{slow ? `Taking longer than expected. Open ${app.title} in a new tab if its login or frame policy blocks embedding.` : `Loading ${app.title}…`}</div> : null}
      <iframe key={`${revision}:${app.sandbox}`} src={app.url} title="n8n automation editor" sandbox={app.sandbox} referrerPolicy="no-referrer" className="h-full w-full border-0 bg-background" onLoad={() => setLoading(false)} onError={() => { setLoading(true); setSlow(true); }}/>
    </div> : <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">{app.reason || `${app.title} opens in a separate tab. Embedded access is not enabled for this provider.`}</div>}
    <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground [@media(max-height:520px)]:sr-only">{app.title} keeps its own login. Sign in in a new tab, then reload here. If embedding is blocked, use Open {app.title}.</p>
  </div>;
}

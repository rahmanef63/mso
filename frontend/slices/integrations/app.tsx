"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Preserve transfer/setup deep links without putting private capabilities in React state. */
export function managerLocation(search: string, hash = "") {
  const transfer = new URLSearchParams(search).get("transfer") === "1";
  return "/integrations/manager" + (transfer ? "?transfer=1" : "") + hash;
}

export default function IntegrationsApp() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const target = frame.current;
    if (!target) return;
    target.src = managerLocation(window.location.search, window.location.hash);
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    const timer = window.setTimeout(() => setStatus(current => current === "loading" ? "error" : current), 15000);
    return () => window.clearTimeout(timer);
  }, [retry]);
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Integrations">
      {status !== "ready" && <div className="flex items-center justify-between gap-3 border-b p-3">
        <p role={status === "error" ? "alert" : "status"} className="text-sm text-muted-foreground">
          {status === "error" ? "The connection manager did not finish loading." : "Opening the native connection manager…"}
        </p>
        {status === "error" && <Button variant="secondary" onClick={() => { setStatus("loading"); setRetry(n => n + 1); }}>Retry</Button>}
      </div>}
      <iframe ref={frame} title="MSO native Integrations manager" className="min-h-0 w-full flex-1 border-0"
        referrerPolicy="no-referrer" onLoad={() => { if (frame.current?.getAttribute("src")) setStatus("ready"); }}
        onError={() => setStatus("error")} />
    </section>
  );
}

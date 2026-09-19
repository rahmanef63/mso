"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton, toast } from "@/features/appshell";
import { Button } from "@/components/ui/button";

// OpenAI/ChatGPT Codex device OAuth. Credential connection and active-provider
// selection are deliberately separate: "Connect OpenAI" preserves Alfa's current
// provider/model, while "Connect & use" explicitly switches after authorization.
export function OAuthConnect({ onConnected }: { onConnected: () => void }) {
  const [flow, setFlow] = useState<{ userCode: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectAfterConnect, setSelectAfterConnect] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  function stop() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setBusy(false);
    setFlow(null);
    setSelectAfterConnect(false);
  }

  async function start(select: boolean) {
    setBusy(true);
    setSelectAfterConnect(select);
    try {
      const r = await fetch("/api/oauth/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(d.error || "Couldn’t start sign-in", { tone: "error" });
        setBusy(false);
        setSelectAfterConnect(false);
        return;
      }
      setFlow({ userCode: d.userCode, url: d.verificationUrl });
      window.open(d.verificationUrl, "_blank", "noopener,noreferrer");
      schedule(Math.max(3000, d.intervalMs || 5000), select);
    } catch {
      toast("Couldn’t reach the server", { tone: "error" });
      setBusy(false);
      setSelectAfterConnect(false);
    }
  }

  function schedule(intervalMs: number, select: boolean) {
    timer.current = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/oauth/openai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "poll", select }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) {
          stop();
          toast(select ? "OpenAI connected and selected" : "OpenAI connected — current Alfa provider kept");
          onConnected();
          return;
        }
        if (!r.ok) {
          stop();
          toast(d.error || "Sign-in failed", { tone: "error" });
          return;
        }
      } catch {
        /* transient network blip — keep polling */
      }
      schedule(intervalMs, select);
    }, intervalMs);
  }

  return (
    <div>
      {!flow ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="[@media(pointer:coarse)]:min-h-[44px]" disabled={busy} onClick={() => start(false)}>
              {busy ? "Starting…" : "Connect OpenAI"}
            </Button>
            <Button size="sm" className="[@media(pointer:coarse)]:min-h-[44px]" disabled={busy} onClick={() => start(true)}>
              Connect &amp; use
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Connect OpenAI keeps Alfa&apos;s current provider/model. Connect &amp; use switches Alfa to an account-available Codex model after authorization.
          </p>
        </div>
      ) : (
        <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p>{selectAfterConnect ? "Connect OpenAI and use it for Alfa." : "Connect OpenAI and keep the current Alfa provider."}</p>
          <p>Enter this code at:</p>
          <div className="flex items-center gap-1">
            <a className="min-w-0 flex-1 truncate text-primary underline" href={flow.url} target="_blank" rel="noreferrer">
              {flow.url}
            </a>
            <CopyButton value={flow.url} label="verification link" />
          </div>
          <div className="flex items-center gap-1">
            <p className="font-mono text-lg tracking-widest">{flow.userCode}</p>
            <CopyButton value={flow.userCode} label="device code" history={false} />
          </div>
          <p className="text-xs text-muted-foreground">Waiting for authorization…</p>
          <Button variant="ghost" size="sm" className="text-muted-foreground [@media(pointer:coarse)]:min-h-[44px]" onClick={stop}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

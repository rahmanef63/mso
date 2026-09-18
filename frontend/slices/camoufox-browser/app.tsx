"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Power, ScanEye } from "lucide-react";
import { IS_DEMO } from "@/lib/demo";
import { PowerPanel } from "./power-panel";
import { fetchStatus, setPower, waitForViewer, verifyViewerTransport, type CamoufoxServiceStatus } from "./service-client";

// Camoufox runs on the host, streamed as pixels through a separately authenticated
// noVNC origin. Never embed its third-party JS on the cockpit origin.
// The full viewer supplies touch keyboard input; resize=remote plus the host
// window manager reflows the framebuffer rather than scaling a desktop thumbnail.
/** The display's VNC password, fetched for this already-authenticated session so
 *  noVNC does not prompt on every open. Absent = none configured; let noVNC ask. */
async function viewerSrc(): Promise<string | null> {
  try {
    const response = await fetch("/api/v1/camoufox/session", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      password?: string | null;
      viewerOrigin?: string | null;
      viewerTicket?: string | null;
    };
    if (!payload.viewerOrigin || !payload.viewerTicket) return null;
    const viewer = payload.viewerOrigin + "/vnc.html?path=websockify&autoconnect=1&resize=remote";
    const fragment = new URLSearchParams({ viewer_ticket: payload.viewerTicket });
    // Password and viewer ticket live in the URL fragment, never the request/query.
    // The sibling viewer bootstrap exchanges the short-lived ticket for a host-only
    // HttpOnly cookie, removes it from the fragment, then loads noVNC.
    if (payload.password) fragment.set("password", payload.password);
    return viewer + "#" + fragment.toString();
  } catch {
    return null;
  }
}

export default function CamoufoxBrowser() {
  const [status, setStatus] = useState<CamoufoxServiceStatus | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Connect = wait for the same-origin service API to confirm loopback noVNC readiness,
  // THEN mount the cross-origin iframe. Split
  // from the power action because it is also the mount path for a session that was
  // already up before this window opened.
  const connect = useCallback(async (signal: AbortSignal) => {
    const ready = await waitForViewer(signal, 30_000, setStatus);
    if (signal.aborted) return;
    if (!ready) {
      setError("The browser session started but is not answering. Check its logs on the host.");
      setSrc(null); // A failed connection must not falsify the host power state.
      return;
    }
    try { await verifyViewerTransport(signal); }
    catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "The secure viewer is unavailable");
      setSrc(null);
      return;
    }
    const source = await viewerSrc();
    if (signal.aborted) return;
    if (!source) {
      setError("Secure browser embedding is unavailable until the split-origin host template is configured.");
      return;
    }
    setSrc(source);
  }, []);

  useEffect(() => {
    if (IS_DEMO) return; // nothing to connect to; the panel below explains
    const controller = new AbortController();
    abort.current = controller;
    void (async () => {
      try {
        const current = await fetchStatus(controller.signal);
        if (controller.signal.aborted) return;
        setStatus(current);
        if (current.running) await connect(controller.signal);
      } catch (cause) {
        if (controller.signal.aborted) return;
        // Show WHY, then fall through to the panel so there is still a button to
        // retry with — a bare error screen would be a dead end.
        setError(cause instanceof Error ? cause.message : "The browser session is unreachable");
        setStatus({ running: false, enabled: false, installed: true });
      }
    })();
    return () => controller.abort();
  }, [connect]);

  const retryConnection = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(null); setSrc(null);
    try { await connect(controller.signal); }
    catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The browser session is unreachable");
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  }, [connect]);

  const power = useCallback(async (on: boolean) => {
    // Reversible in one click, and the browser profile (so any logged-in session)
    // lives on disk rather than in the process — but a stop still costs ~10 s to
    // undo, so it gets the same confirm the managed-apps cards use.
    if (!on && !window.confirm("Turn the browser session off? It stops the browser running on the server.")) return;
    setBusy(true);
    setError(null);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const next = await setPower(on, controller.signal);
      if (controller.signal.aborted) return;
      setSrc(null);
      setStatus(next);
      if (on) await connect(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Could not change the browser session");
      }
    } finally {
      setBusy(false);
    }
  }, [connect]);

  // The demo has no host, so there is no display to attach to and the VNC gate would
  // refuse every request anyway. Say what this app is instead of framing a 404 —
  // the demo is a showcase, and a dead black rectangle showcases nothing.
  if (IS_DEMO) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <ScanEye className="size-8 text-muted-foreground" />
        <p className="max-w-md text-sm font-medium">The browser runs on the server, not in this tab.</p>
        <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
          MSO&apos;s browser is a real Camoufox (anti-fingerprinting Firefox) running on the
          host&apos;s own display, streamed here over VNC — so it renders the whole web,
          including the majority of sites that refuse to be put in an iframe. The demo has
          no host attached, so there is nothing to stream. On a real install this window is
          a full browser.
        </p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex h-full w-full items-center justify-center gap-2 bg-background text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking the browser session…
      </div>
    );
  }

  if (!status.running) {
    return <PowerPanel status={status} busy={busy} error={error} onStart={() => void power(true)} />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-black">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-1">
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <span className="truncate text-[11px] text-muted-foreground">Running on the server</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void power(false)}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
          {busy ? "Working…" : "Turn off"}
        </button>
      </header>
      {error && <div role="alert" className="shrink-0 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
        <p>{error}</p><button type="button" disabled={busy} className="mt-2 underline" onClick={() => void retryConnection()}>Retry connection</button>
      </div>}
      {src ? (
        <iframe
          src={src}
          title="Camoufox browser"
          className="min-h-0 w-full flex-1 border-0 bg-black"
          allow="clipboard-read; clipboard-write; fullscreen"
          sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock allow-downloads"
          referrerPolicy="no-referrer"
          allowFullScreen
        />
      ) : !error ? (
        <div className="flex min-h-0 w-full flex-1 items-center justify-center gap-2 bg-black text-xs text-white/60">
          <Loader2 className="size-4 animate-spin" /> Connecting to the browser session…
        </div>
      ) : null}
    </div>
  );
}

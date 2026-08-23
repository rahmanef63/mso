"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Power, ScanEye } from "lucide-react";
import { IS_DEMO } from "@/lib/demo";
import { PowerPanel } from "./power-panel";
import { fetchStatus, setPower, waitForViewer, type CamoufoxServiceStatus } from "./service-client";

// A REAL Firefox (Camoufox, anti-fingerprinting) running on a headless X display on
// this host, shown over noVNC. This replaced the old iframe browser because an iframe
// cannot render most of the web: X-Frame-Options / frame-ancestors refuse framing on
// the majority of real sites, so that app could only ever show the minority that
// opted in. Here the page is rendered by an actual browser process and only PIXELS
// cross into the cockpit — nothing to refuse, and no third-party JS in this origin.
//
// `/camoufox-vnc/*` is gated in proxy.ts by the same verified-session check that
// guards /api/v1/exec, and rewritten to loopback websockify from there.
//
// The window OWNS the host session's power (see service-client + power-panel):
// hiding this app used to leave a browser, an Xvfb and an x11vnc running for nobody,
// and only a root shell could stop them. The switch in the header drives the
// `camoufox-vnc` user unit, so what the UI says is what the host is doing.
//
// vnc.html, NOT vnc_lite.html, and this is what makes the app usable on a phone:
//  • vnc_lite has no focusable text input anywhere, and noVNC's on-screen keyboard
//    lives in the full UI (#noVNC_keyboard_button + a hidden textarea), not in core.
//    Tapping a canvas focuses nothing, so on touch the OS keyboard never opens and
//    the remote Firefox can never receive a keystroke — no URL, no search, no login.
//  • resize=remote instead of scale=true. scale only shrinks-to-fit and keeps the
//    aspect ratio, so a 1440x920 desktop landed at 0.273x inside a 393px phone
//    window with ~60% of the window as empty letterbox — the "black rectangle".
//    resize=remote drives the framebuffer to the client's own box (measured 393x727)
//    for 1:1 pixels and no letterbox. It only works because a window manager now runs
//    on the display (see scripts/camoufox-vnc-service) — without one the browser
//    window never reflows on the RANDR change and the client gets a cropped corner.
const VIEWER = "/camoufox-vnc/vnc.html?path=camoufox-vnc/websockify&autoconnect=1&resize=remote";

/** The display's VNC password, fetched for this already-authenticated session so
 *  noVNC does not prompt on every open. Absent = none configured; let noVNC ask. */
async function viewerSrc(): Promise<string> {
  try {
    const response = await fetch("/api/v1/camoufox/session", { cache: "no-store" });
    if (response.ok) {
      const password = ((await response.json()) as { password?: string | null }).password ?? null;
      // `#password=`, never `&password=`. Behind this display sits a live Google session,
      // so the VNC password is the second lock on it and must not end up anywhere it can
      // be read back: a fragment is never sent to the server, so it cannot land in a
      // Traefik access log, a Next.js request log, or a Referer header — a query string
      // can do all three the moment anyone enables logging. noVNC reads either, and
      // prefers the fragment (WebUtil.getConfigVar → getHashVar first, app/ui.js:997).
      if (password) return `${VIEWER}#password=${encodeURIComponent(password)}`;
    }
  } catch {
    // Offline or route missing — fall through to the prompting viewer.
  }
  return VIEWER;
}

export default function CamoufoxBrowser() {
  const [status, setStatus] = useState<CamoufoxServiceStatus | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Connect = wait for websockify to actually answer, THEN mount the iframe. Split
  // from the power action because it is also the mount path for a session that was
  // already up before this window opened.
  const connect = useCallback(async (signal: AbortSignal) => {
    const ready = await waitForViewer(signal);
    if (signal.aborted) return;
    if (!ready) {
      setError("The browser session started but is not answering. Check its logs on the host.");
      setStatus((current) => (current ? { ...current, running: false } : current));
      return;
    }
    const source = await viewerSrc();
    if (!signal.aborted) setSrc(source);
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
      {error && <p className="shrink-0 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">{error}</p>}
      {src ? (
        <iframe
          src={src}
          title="Camoufox browser"
          className="min-h-0 w-full flex-1 border-0 bg-black"
          allow="clipboard-read; clipboard-write"
          allowFullScreen
        />
      ) : (
        <div className="flex min-h-0 w-full flex-1 items-center justify-center gap-2 bg-black text-xs text-white/60">
          <Loader2 className="size-4 animate-spin" /> Connecting to the browser session…
        </div>
      )}
    </div>
  );
}

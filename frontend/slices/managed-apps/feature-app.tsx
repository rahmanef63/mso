"use client";

import { ExternalLink, RefreshCw, Settings2, TerminalSquare } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { AppProps } from "@/features/appshell";
import { Terminal } from "@/features/os-terminal";
import type { ManagedAppFeature } from "@/lib/managed-apps/types";
import { requestAuthorizedFrame, selectAuthorizedFrame } from "./app-authorization";
import { cliCommand, dashboardSurfaceSource, featureSource } from "./feature-cli";

export function ManagedFeatureApp({
  feature,
  publicDashboardUrl,
  detailsOpen = false,
  onToggleDetails,
}: AppProps & {
  feature: ManagedAppFeature;
  publicDashboardUrl?: string | null;
  /** MSO-owned controls (lifecycle, logs, update) live in the surface, but their
   *  toggle belongs in THIS bar: two stacked toolbars cost 80px and pushed the app
   *  down for no information. */
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
}) {
  const embeddedSource = featureSource(feature);
  const surface = dashboardSurfaceSource(embeddedSource, publicDashboardUrl);
  const directSource = surface.kind === "direct" ? surface.source : null;
  const uiAvailable = surface.source !== null;
  const command = cliCommand(feature);
  // Existing configured domain wins: that split-origin URL is the safe embeddable UI,
  // exactly like Hermes/OpenClaw. The public-IP URL is only a no-domain fallback. We do
  // not iframe an http:// public IP inside an https:// cockpit (mixed content), and we
  // never fall back to a same-origin vendor iframe.
  const [generation, setGeneration] = useState(0);
  // Result is keyed by generation so a refresh/remount invalidates the previous
  // authorization by derivation — no synchronous setState in the effect, and a
  // stale in-flight response can never re-mount the old frame.
  const [authState, setAuthState] = useState<{ generation: number; auth: { source: string; url: string } | null; error: boolean }>({ generation: -1, auth: null, error: false });
  const [view, setView] = useState<"ui" | "cli">(() => (uiAvailable ? "ui" : "cli"));

  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    if (surface.kind !== "embedded" || !embeddedSource) return;
    const controller = new AbortController();
    void requestAuthorizedFrame(feature.applicationId, embeddedSource, controller.signal)
      .then((auth) => { if (!controller.signal.aborted) setAuthState({ generation, auth, error: false }); })
      .catch(() => { if (!controller.signal.aborted) setAuthState({ generation, auth: null, error: true }); });
    return () => controller.abort();
  }, [embeddedSource, feature.applicationId, generation, surface.kind]);
  const current = embeddedSource ? selectAuthorizedFrame(authState, generation, embeddedSource) : { url: null, error: false };
  const authorizedSource = current.url;
  const authorizationError = current.error;

  // One control, reused by both surfaces: on the terminal it rides the tab strip, on the
  // dashboard it rides the small bar that also holds the refresh/open actions.
  const detailsButton = onToggleDetails ? (
    <button
      type="button"
      onClick={onToggleDetails}
      aria-pressed={detailsOpen}
      aria-label="Application details"
      title="Application details"
      className={`grid size-7 place-items-center rounded text-[#9298a4] hover:bg-white/10 hover:text-white ${detailsOpen ? "bg-white/10 text-white" : ""}`}
    >
      <Settings2 className="size-3.5" />
    </button>
  ) : null;
  const detailsAction = detailsButton;
  // Said once, inside the terminal, only when there is genuinely no dashboard. It is not
  // chrome: the terminal below starts with a "no browser UI" line the operator can read in
  // place, instead of a full-width bar repeating it above a window title that already names
  // the app.
  const noDashboardNotice =
    feature.applicationId === "hermes"
      ? "No browser dashboard on this host, so this terminal is the app. Set NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE to embed the Hermes UI instead."
      : "No browser UI is exposed by this deployment, so this is the view. A split-origin dashboard host is optional.";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* No header. Three chrome bands became one, then the operator asked for this one
          gone too: it was a row of text above a terminal that already says which app it is
          (window title) and whether a dashboard exists (there is none, so the terminal IS
          the surface). The note moved to where it is unavoidably true, the terminal's own
          first line, and the only control rides the terminal's existing tab strip so it
          costs no row at all. */}
      {view === "cli" || !uiAvailable ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <Terminal initialCommand={command} actions={detailsAction} notice={uiAvailable ? undefined : noDashboardNotice} />
          </Suspense>
        </div>
      ) : directSource ? (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold"><ExternalLink className="size-4" />{feature.title} UI</div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              This server exposes the app directly on its public IP, so no domain or DNS provider is required. Open it as a separate origin; HTTPS MSO cannot safely embed this HTTP endpoint.
            </p>
            <code className="mt-3 block overflow-x-auto rounded-md bg-muted px-3 py-2 text-[11px]">{directSource}</code>
            <a href={directSource} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
              <ExternalLink className="size-3.5" /> Open {feature.title}
            </a>
          </div>
        </div>
      ) : !authorizedSource ? (
        <p className="p-3 text-sm">{authorizationError ? "Application authorization failed. Refresh to retry." : "Authorizing application..."}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-end gap-1.5 px-2 py-1">
            <button type="button" onClick={() => setView("cli")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground" aria-label="Switch to CLI view"><TerminalSquare className="size-3.5" />CLI</button>
            {!directSource ? <button type="button" onClick={reload} className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Refresh feature"><RefreshCw className="size-3.5" /></button> : null}
            <a href={directSource ?? authorizedSource ?? undefined} target="_blank" rel="noreferrer" className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Open feature in dedicated tab"><ExternalLink className="size-3.5" /></a>
            {detailsButton}
          </div>
          <iframe
            key={generation}
            src={authorizedSource}
            title={`${feature.applicationId} ${feature.title}`}
            className="min-h-0 flex-1 border-0 bg-background"
          // allow-same-origin stays, and is the whole point: these SPAs need their own
          // cookies and storage or they do not boot (Hermes reads localStorage inside a
          // useState initializer — an opaque origin throws SecurityError mid-render). It is
          // safe only because the frame sits on the app's OWN host: same-origin with
          // itself, cross-origin with the cockpit, so `window.top` is opaque and
          // /api/v1/exec is not a route on that host at all. This element must never be
          // pointed at a cockpit-origin URL again.
          //
          // Still no allow-popups, in either mode — re-checked now that a popup would open
          // on the APP's origin rather than the cockpit's. The flows that want it stay dead
          // regardless: Hermes' 2 call sites are provider OAuth whose callback is the
          // upstream's own 127.0.0.1 (unreachable from the browser), and OpenClaw's 4 are
          // external links, ctrl-click terminal links and an open-in-editor deep link —
          // destinations for the user's own browser, not this frame. Counted across the
          // whole installed bundles, not just the entry chunk. So granting it would buy
          // nothing and still hand upstream JS a top-level, address-bar-bearing window
          // pointed at any URL it likes.
          //
          // A banner used to sit above this frame explaining that those clicks are a
          // deliberate no-op, and which external hosts the CSP intersection kills. It was
          // removed by request: it appeared on every feature view, could not be dismissed
          // for good (the state was per-mount), and read as a permanent complaint. The
          // consequence is real and is the reason this note exists — those clicks are now
          // silent, and OpenClaw's Gemini live-audio socket fails inside the frame with
          // nothing on screen to say why. PROXY_BLOCKED_EXTERNALS in
          // lib/managed-apps/proxy-headers.ts still records exactly which hosts and why.
            sandbox="allow-forms allow-modals allow-same-origin allow-scripts allow-downloads"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}

// NoDashboardPanel lived here and explained NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE at
// length. Deleted: it was unreachable (see the render branch above), and a deployment with
// no browser UI gets the CLI. Public-port apps can instead advertise a direct,
// separate-origin URL without requiring split-origin DNS; featureSource() remains the
// embedded-dashboard decision for apps that do use dedicated hosts.

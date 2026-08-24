"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, FileText, Loader2, Play, RefreshCw, Route, Save, SlidersHorizontal, Square, Workflow, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ManagedAppAction, ManagedAppId, ManagedAppView } from "@/lib/managed-apps/types";
import { dashboardFeature } from "./feature-cli";
import { ManagedFeatureApp } from "./feature-app";
import { Hero, InstallSurface, UpdateCentrePanel } from "./update-panel";

function useManagedApps() {
  const [apps, setApps] = useState<ManagedAppView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/managed-apps", { cache: "no-store" });
      const payload = await response.json() as { apps?: ManagedAppView[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Managed applications unavailable");
      setApps(payload.apps ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Managed applications unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Visibility-gated: each refresh detects every managed app on the host (systemd
    // probes + `--version` forks), so a backgrounded tab must not keep paying for it.
    const initial = window.setTimeout(() => void refresh(), 0);
    const tick = () => {
      if (!document.hidden) void refresh();
    };
    const timer = window.setInterval(tick, 10_000);
    const onVis = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const act = useCallback(async (id: ManagedAppId, action: ManagedAppAction) => {
    if ((action === "stop" || action === "restart") && !window.confirm(`${action === "stop" ? "Stop" : "Restart"} ${id}?`)) return;
    setBusy(`${id}:${action}`);
    try {
      const response = await fetch(`/api/v1/managed-apps/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json() as { app?: ManagedAppView; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Operation failed");
      if (payload.app) setApps((current) => current.map((app) => app.id === id ? payload.app! : app));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed");
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [refresh]);

  return { apps, error, loading, busy, refresh, act };
}

export function HermesApp() {
  return <ManagedAppsSurface focus="hermes" />;
}

export function OpenClawApp() {
  return <ManagedAppsSurface focus="openclaw" />;
}

export function NineRouterApp() {
  return <ManagedAppsSurface focus="9router" />;
}

const NAME: Record<ManagedAppId, string> = { hermes: "Hermes", openclaw: "OpenClaw", "9router": "9Router" };

const MARK: Record<ManagedAppId, { Icon: LucideIcon; tone: string }> = {
  hermes: { Icon: Bot, tone: "text-violet-400" },
  openclaw: { Icon: Workflow, tone: "text-orange-400" },
  "9router": { Icon: Route, tone: "text-sky-400" },
};

function AppMark({ id, className }: { id: ManagedAppId; className?: string }) {
  const { Icon, tone } = MARK[id];
  return <Icon className={`${className ?? "size-4"} ${tone}`} />;
}

const ICON: Record<ManagedAppId, React.ReactNode> = {
  hermes: <AppMark id="hermes" />,
  openclaw: <AppMark id="openclaw" />,
  "9router": <AppMark id="9router" />,
};

/** ONE surface, and what it shows is the thing itself: the app's own dashboard when the
 *  app is there, and an install button when it is not. There used to be a
 *  `dashboard | manage` tab pair, which got both cases wrong — an absent app still mounted
 *  the vendor iframe (a dead frame pointed at a 502 after an uninstall) and the only
 *  Install button lived two clicks away under "manage".
 *
 *  Everything MSO owns rather than shows — lifecycle, logs, version, update, rollback,
 *  uninstall — moved behind one Details toggle. It is the same ManagePane; it is just no
 *  longer what you land on. */
function ManagedAppsSurface({ focus }: { focus: ManagedAppId }) {
  const state = useManagedApps();
  const [details, setDetails] = useState(false);
  const feature = useMemo(() => dashboardFeature(focus, NAME[focus]), [focus]);
  const app = useMemo(() => state.apps.find((entry) => entry.id === focus) ?? null, [focus, state.apps]);
  // Detection has to land before anything is drawn: rendering the frame first and swapping
  // it out is exactly the dead-iframe flash this replaced.
  const settled = !state.loading || app !== null;
  const running = app?.state === "running";
  // Is there anything for the iframe to SHOW? "installed" was the wrong question and put a
  // dead frame on screen: OpenClaw installed fine, its gateway never came up, and the
  // window mounted the vendor UI anyway — which rendered the proxy's own
  // {"error":"managed application upstream unavailable"} as raw JSON, Firefox
  // Pretty-print checkbox and all. `starting` and `unhealthy` still get the frame: one is
  // about to answer, the other is answering badly, and both are better seen than hidden.
  const live = app !== null && ["running", "unhealthy", "starting"].includes(app.state);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {ICON[focus]}
        <h2 className="text-sm font-semibold">{NAME[focus]}</h2>
        {settled && app ? (
          <span
            aria-label={`state: ${app.state}`}
            title={app.state}
            className={`size-1.5 rounded-full ${running ? "bg-emerald-400" : app.state === "unhealthy" ? "bg-red-400" : "bg-muted-foreground/40"}`}
          />
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setDetails((was) => !was)}
          aria-pressed={details}
          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${details ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <SlidersHorizontal className="size-3.5" />
          Details
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {!settled ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Detecting {NAME[focus]}…
          </div>
        ) : details ? (
          <ManagePane focus={focus} state={state} />
        ) : !app ? (
          // Detection answered without this app in it — a 503 from the list route, or a
          // response one element short. Never the iframe: that is how a data problem
          // became a dead frame in the first place.
          <Hero icon={ICON[focus]} title={NAME[focus]}>
            <p className="text-xs leading-relaxed text-muted-foreground">
              MSO could not read this application&apos;s state on the server{state.error ? `: ${state.error}` : "."} Nothing has
              been changed. Retry, or open Details for the management view.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => void state.refresh()}>
              <RefreshCw aria-hidden />
              Try again
            </Button>
          </Hero>
        ) : !app.installed ? (
          <InstallSurface app={app} icon={ICON[focus]} onChanged={state.refresh} />
        ) : !live ? (
          <Hero icon={ICON[focus]} title={app.name} description={app.description}>
            <Button type="button" className="w-full" size="lg" disabled={state.busy === `${focus}:start`} onClick={() => void state.act(focus, "start")}>
              {state.busy === `${focus}:start` ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
              {state.busy === `${focus}:start` ? `Starting ${focus}…` : `Start ${focus}`}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Installed on the server{app.version ? ` (${app.version})` : ""}, but not running — so there is nothing to show
              yet. Its own dashboard appears here once the service is up. Logs, update and uninstall are under Details.
            </p>
          </Hero>
        ) : (
          <ManagedFeatureApp feature={feature} />
        )}
      </div>
    </div>
  );
}

function ManagePane({ focus, state }: { focus: ManagedAppId; state: ReturnType<typeof useManagedApps> }) {
  const visible = useMemo(() => state.apps.filter((app) => app.id === focus), [focus, state.apps]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-[11px] text-muted-foreground">MSO management layer · independent runtime and state</p>
        <button type="button" onClick={() => void state.refresh()} className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Refresh applications"><RefreshCw className="size-3.5" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4">
        {state.error && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</div>}
        {state.loading ? <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Detecting applications…</div> : (
          <div className="grid grid-cols-1 gap-4">
            {visible.map((app) => <ManagedCard key={app.id} app={app} busy={state.busy} onAction={state.act} onChanged={state.refresh} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function ManagedCard({ app, busy, onAction, onChanged }: { app: ManagedAppView; busy: string | null; onAction: (id: ManagedAppId, action: ManagedAppAction) => Promise<void>; onChanged: () => void }) {
  const [logs, setLogs] = useState<string[] | null>(null);
  const icon = <AppMark id={app.id} className="size-5" />;
  const run = app.state === "running";
  async function loadLogs() {
    const response = await fetch(`/api/v1/managed-apps/${app.id}/logs`, { cache: "no-store" });
    const payload = await response.json() as { entries?: string[] };
    setLogs(payload.entries ?? []);
  }
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">{icon}<div><h3 className="text-sm font-semibold">{app.name}</h3><p className="text-xs text-muted-foreground">{app.description}</p></div></div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${run ? "bg-emerald-500/15 text-emerald-400" : app.state === "unhealthy" ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground"}`}>{app.state}</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-muted-foreground">Installation</dt><dd className="font-medium">{app.installationType}</dd></div>
        <div><dt className="text-muted-foreground">Version</dt><dd className="truncate font-medium">{app.version ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Health</dt><dd className="font-medium">{app.healthy === null ? "unknown" : app.healthy ? "healthy" : "unhealthy"}</dd></div>
        <div><dt className="text-muted-foreground">Isolation</dt><dd className="font-medium">independent</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {!run && app.supportedActions.includes("start") && <Action icon={<Play />} label="Start" busy={busy === `${app.id}:start`} onClick={() => void onAction(app.id, "start")} />}
        {run && app.supportedActions.includes("stop") && <Action icon={<Square />} label="Stop" busy={busy === `${app.id}:stop`} onClick={() => void onAction(app.id, "stop")} />}
        {app.supportedActions.includes("restart") && <Action icon={<RefreshCw />} label="Restart" busy={busy === `${app.id}:restart`} onClick={() => void onAction(app.id, "restart")} />}
        {app.supportedActions.includes("backup") && <Action icon={<Save />} label="Backup" busy={busy === `${app.id}:backup`} onClick={() => void onAction(app.id, "backup")} />}
        <Action icon={<FileText />} label="Logs" busy={false} onClick={() => void loadLogs()} />
      </div>
      {logs && <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/30 p-3 text-[10px] leading-relaxed text-muted-foreground">{logs.length ? logs.join("\n") : "Logs unavailable"}</pre>}
      {/* Update/rollback/uninstall are jobs, not lifecycle actions: they outlive
          the request and restart the service, so they get their own panel below
          the lifecycle buttons rather than another button beside them. */}
      <UpdateCentrePanel app={app} onChanged={onChanged} />
    </section>
  );
}

function Action({ icon, label, busy, onClick }: { icon: React.ReactElement<{ className?: string }>; label: string; busy: boolean; onClick: () => void }) {
  return <button type="button" disabled={busy} onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <span className="[&>svg]:size-3.5">{icon}</span>}{busy ? "Working…" : label}</button>;
}

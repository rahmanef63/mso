"use client";

import { useState } from "react";
import { MonitorPlay, RefreshCw } from "lucide-react";
import { screenshotUrl, SCREENS, isRunning, type BotDesktop } from "./lib/api";
import { useDesktops } from "./lib/use-desktops";

/**
 * Bot desktops: every container grokbot created on this host (label
 * `grokbot.desktop=1`), with a live screenshot per display and the four lifecycle
 * verbs the API exposes.
 *
 * Why this app exists: MSO could already list, screenshot and restart those
 * containers over /api/v1/desktop/*, but nothing in the shell used it. The API was
 * finished and unreachable, which is the same as absent.
 */
export default function BotDesktopsApp() {
  const { desktops, running, loading, error, blocked, busy, logs, refresh, act, clearLogs } = useDesktops();

  return (
    <div data-slot="bot-desktops" className="@container flex h-full min-h-0 min-w-0 flex-col bg-[color:var(--window-bg)] text-[color:var(--text)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--separator)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-[color:var(--inset)]"><MonitorPlay className="size-4" /></div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Bot desktops</h2>
            <p className="truncate text-[11px] text-[color:var(--text-dim)]">
              {loading ? "Reading the host…" : error ? "Not available" : `${desktops.length} found · ${running} running`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh bot desktops"
          title="Refresh"
          className="rounded-lg border border-[color:var(--separator)] px-2 py-1.5 text-xs hover:bg-[color:var(--inset)]"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
            {error}
            {blocked && <span className="mt-1 block text-[color:var(--text-dim)]">Refresh will retry once you are signed in.</span>}
          </p>
        )}

        {/* "Nothing to show" and "you may not look" are different states. Saying
            "no desktops on this host" to a signed-out visitor is a lie that sends
            them hunting for a Docker problem instead of signing in. */}
        {!loading && desktops.length === 0 && !error && (
          <div className="rounded-xl border border-[color:var(--separator)] bg-[color:var(--surface)] p-4 text-xs text-[color:var(--text-dim)]">
            No bot desktops on this host. They appear once grokbot runs with
            <code className="mx-1 rounded bg-[color:var(--inset)] px-1 py-0.5 font-mono">DESKTOP_MODE=docker</code>
            and creates a container.
          </div>
        )}

        <div className="grid gap-4 @min-[820px]:grid-cols-2">
          {desktops.map((desktop) => (
            <DesktopCard
              key={desktop.id}
              desktop={desktop}
              busy={busy}
              onAct={(action) => void act(desktop.name, action)}
            />
          ))}
        </div>
      </div>

      {logs && (
        <div className="max-h-56 shrink-0 overflow-y-auto border-t border-[color:var(--separator)] bg-[color:var(--inset)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] text-[color:var(--text-dim)]">logs · {logs.container}</span>
            <button type="button" onClick={clearLogs} className="text-[11px] underline">close</button>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-4 text-[color:var(--text-dim)]">
            {logs.lines.join("\n") || "(no output)"}
          </pre>
        </div>
      )}
    </div>
  );
}

function DesktopCard({
  desktop,
  busy,
  onAct,
}: {
  desktop: BotDesktop;
  busy: string | null;
  onAct: (action: "start" | "stop" | "restart" | "logs") => void;
}) {
  // One screen at a time: four live <img> per card would be four `docker exec`
  // calls per refresh, and a person is looking at one bot's display anyway.
  const [screen, setScreen] = useState<string>("99");
  const [generation, setGeneration] = useState(0);
  const live = isRunning(desktop);
  const pending = (action: string) => busy === `${desktop.name}:${action}`;

  return (
    <section className="rounded-xl border border-[color:var(--separator)] bg-[color:var(--surface)] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-xs font-semibold">{desktop.name}</h3>
          <p className="truncate text-[10px] text-[color:var(--text-dim)]">
            {desktop.state}
            {desktop.labels.bot ? ` · bot ${desktop.labels.bot}` : ""}
            {desktop.labels.user ? ` · ${desktop.labels.user}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${live ? "bg-emerald-500/10 text-emerald-600" : "bg-[color:var(--inset)] text-[color:var(--text-dim)]"}`}
        >
          {desktop.status || desktop.state}
        </span>
      </div>

      <div className="mb-2 flex items-center gap-1">
        {SCREENS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setScreen(value)}
            aria-pressed={screen === value}
            className={`rounded px-2 py-0.5 font-mono text-[10px] ${screen === value ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]" : "bg-[color:var(--inset)] text-[color:var(--text-dim)]"}`}
          >
            :{value}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setGeneration((value) => value + 1)}
          className="ml-auto rounded bg-[color:var(--inset)] px-2 py-0.5 text-[10px] text-[color:var(--text-dim)]"
        >
          reload frame
        </button>
      </div>

      {live ? (
        // A live container frame, not a static asset: the bytes come from
        // /api/v1/desktop/screenshot, which runs `docker exec` per request. next/image
        // would try to optimise and cache a URL whose content changes every reload.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={screenshotUrl(desktop.name, screen, generation)}
          alt={`Bot desktop ${desktop.name} display :${screen}`}
          className="aspect-video w-full rounded-lg border border-[color:var(--separator)] bg-black object-contain"
        />
      ) : (
        <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-[color:var(--separator)] text-[11px] text-[color:var(--text-faint)]">
          stopped — start it to see the screen
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(["start", "stop", "restart", "logs"] as const).map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onAct(action)}
            disabled={pending(action) || (action === "start" && live) || (action !== "start" && action !== "logs" && !live)}
            className="rounded-lg border border-[color:var(--separator)] px-2 py-1 text-[11px] hover:bg-[color:var(--inset)] disabled:opacity-40"
          >
            {pending(action) ? "…" : action}
          </button>
        ))}
      </div>
    </section>
  );
}

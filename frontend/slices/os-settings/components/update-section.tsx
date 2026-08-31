"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, BookOpen, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FormDrawer } from "@/features/os-shell";
import { SettingsSection, SettingsActionRow, SettingsBlock } from "@/features/shell-settings";
import { IS_DEMO } from "@/lib/demo";
import type { UpdateStatus } from "@/lib/host/self-update";
import { UpdateNotes } from "./update-notes";

// Settings → About → Software update. The button the whole deploy hangs off:
// prod is systemd with no webhook, so a commit on main is invisible in the running
// app until someone rebuilds — which used to mean someone with ssh.
//
// `import type` only: lib/host/self-update is "server-only" and the type is erased
// at compile time, so the shape stays shared without the module reaching the bundle.

const POLL_MS = 3_000;
const OK_MARKER = "UPDATE OK";

async function readStatus(check: boolean): Promise<UpdateStatus | null> {
  const res = await fetch(`/api/v1/sys/update${check ? "" : "?check=0"}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as UpdateStatus) : null;
}

export function UpdateSection() {
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  // "An update ran in THIS tab (or was running when we looked)" — the outcome below
  // is derived from it rather than stored, so nothing has to be reset on the next run.
  const [sawRunning, setSawRunning] = useState(false);

  const refresh = useCallback(async (check: boolean) => {
    // A poll that lands while the service is restarting simply fails; keeping the
    // last known state is the honest render, and the next tick recovers.
    const next = await readStatus(check).catch(() => null);
    if (next) {
      setInfo(next);
      if (next.running) setSawRunning(true);
    }
    return next;
  }, []);

  // The first read asks the remote; every later one is the poll below. Written as a
  // subscription-shaped effect (start an external call, set state in ITS callback)
  // rather than calling `refresh` here — the two are the same work, but only this
  // shape is honestly "synchronise with an external system".
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    readStatus(true)
      .catch(() => null)
      .then((next) => {
        if (!alive) return;
        if (next) {
          setInfo(next);
          if (next.running) setSawRunning(true);
        }
        setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Poll only while an update is in flight — including across the restart it ends
  // with, which is the one moment the API is briefly gone.
  useEffect(() => {
    if (!info?.running) return;
    const id = setInterval(() => void refresh(false), POLL_MS);
    return () => clearInterval(id);
  }, [info?.running, refresh]);

  const start = async (rebuildOnly: boolean) => {
    setBusy(true);
    setError(null);
    setSawRunning(true);
    try {
      const res = await fetch("/api/v1/sys/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rebuildOnly }),
      });
      const body = (await res.json()) as UpdateStatus & { error?: string };
      if (!res.ok) setError(body.error ?? `update refused (${res.status})`);
      else setInfo(body);
    } catch {
      setError("could not reach the host");
    } finally {
      setBusy(false);
    }
  };

  if (IS_DEMO || (!info && !checking)) return null;
  const behind = info?.behind ?? 0;
  const running = info?.running ?? false;
  const pending = (info?.pendingBuild ?? false) && behind === 0;
  // Derived, never stored: an update we watched, that is no longer running, either
  // left its marker in the log or stopped before deploying.
  const finished = sawRunning && !running && info ? (info.log.includes(OK_MARKER) ? "ok" : "failed") : null;

  return (
    <SettingsSection
      icon={<ArrowDownToLine />}
      title="Software update"
      footnote={
        info?.supported === false
          ? (info.reason ?? undefined)
          : "Pulls origin/main, proves it compiles out-of-tree, then builds and restarts. The out-of-tree check runs first because an in-place build cannot be undone."
      }
    >
      <SettingsBlock className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium text-foreground">
            {checking
              ? "Checking for updates…"
              : behind > 0
                ? `${behind} update${behind > 1 ? "s" : ""} available`
                : pending
                  ? "A build is pending"
                  : "Up to date"}
          </span>
          {/* The RUNNING commit, not the checkout's — they differ whenever someone
              pulled without rebuilding, and that gap is the whole point of the row. */}
          <span className="font-mono text-[11px] text-muted-foreground">
            running {info?.buildSha || info?.current || "—"}
          </span>
        </div>
        {pending && (
          <p className="text-[11px] text-muted-foreground">
            The checkout is at <span className="font-mono">{info?.current}</span>, which this build was not compiled
            from. Rebuild to run it.
          </p>
        )}
        {info?.currentSubject && <p className="line-clamp-2 text-[11px] text-muted-foreground">{info.currentSubject}</p>}
        {info && info.supported !== false && !info.remoteChecked && !running && (
          <p className="text-[11px] text-amber-500">
            Could not reach the remote — this is what was last fetched, not necessarily what is on main now.
          </p>
        )}
        {error && <p className="text-[11px] text-destructive-text">{error}</p>}
        {finished === "ok" && !running && (
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-500">
            <CheckCircle2 className="size-3.5" /> Updated and restarted — reload to run the new build.
          </p>
        )}
        {finished === "failed" && !running && (
          <p className="text-[11px] text-destructive-text">The update stopped before deploying. The running build was left untouched — see the log.</p>
        )}
        {running && (
          // Same ScrollArea as everything else in Settings, so the updater's
          // transcript scrolls in the panel's own idiom instead of a raw browser
          // scrollbar in the middle of a card.
          <ScrollArea className="max-h-48 rounded-md bg-secondary/60">
            <pre className="p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words">
              {info?.log?.trim() || "starting…"}
            </pre>
          </ScrollArea>
        )}
        {finished === "ok" && !running && (
          <Button type="button" size="sm" className="w-full [@media(pointer:coarse)]:min-h-[44px]" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" /> Reload MSO
          </Button>
        )}
      </SettingsBlock>

      {behind > 0 && info?.supported !== false && (
        <SettingsActionRow
          label={running ? "Updating…" : `Update to ${info?.commits[0]?.sha ?? "latest"} and restart`}
          icon={<ArrowDownToLine />}
          busy={busy || running}
          disabled={running}
          onClick={() => void start(false)}
        />
      )}
      {info?.supported !== false && (
        <SettingsActionRow
          label="Release notes and docs"
          icon={<BookOpen />}
          onClick={() => setNotes(true)}
          trailing={behind > 0 ? <span className="text-[11px] text-muted-foreground">{behind} new</span> : undefined}
        />
      )}
      {info?.supported !== false && !running && (
        // The check runs once, on open. A release that lands while the panel is
        // sitting there would otherwise need the whole window closed and reopened.
        <SettingsActionRow
          label="Check again"
          icon={<Search />}
          busy={checking}
          onClick={() => {
            setChecking(true);
            void refresh(true).finally(() => setChecking(false));
          }}
        />
      )}
      {info?.supported !== false && behind === 0 && (
        <SettingsActionRow
          label={pending ? `Build ${info?.current} and restart` : "Rebuild and restart"}
          icon={<RefreshCw />}
          busy={busy || running}
          disabled={running}
          onClick={() => void start(true)}
        />
      )}

      <FormDrawer open={notes} onOpenChange={setNotes} size="lg">
        <FormDrawer.Header>
          <FormDrawer.Title>{behind > 0 ? `What's in this update (${behind})` : "Release notes"}</FormDrawer.Title>
          <FormDrawer.Description>
            Incoming commits first, then everything already shipped to this deployment.
          </FormDrawer.Description>
        </FormDrawer.Header>
        <UpdateNotes commits={info?.commits ?? []} />
        <FormDrawer.Footer>
          <Button type="button" variant="ghost" onClick={() => setNotes(false)}>
            Close
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </SettingsSection>
  );
}

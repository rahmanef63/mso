"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, BookOpen, RefreshCw, Search } from "lucide-react";
import { SettingsActionRow, SettingsSection } from "@/features/shell-settings";
import { IS_DEMO } from "@/lib/demo";
import type { UpdateStatus } from "@/lib/host/self-update";
import { UpdateAutomationCard } from "./update-automation-card";
import { UpdateNotesDrawer } from "./update-notes-drawer";
import { UpdateStatusCard, UpdateStatusSkeleton, UpdateStatusUnavailable } from "./update-status-card";
import { UpdateStatusUnsupported } from "./update-status-unsupported";
import { readStatus } from "./update-status-client";

const POLL_MS = 3_000;
const OK_MARKER = "UPDATE OK";

export function UpdateSection() {
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  const [sawRunning, setSawRunning] = useState(false);
  const postRunRemoteCheck = useRef(false);

  const refresh = useCallback(async (check: boolean) => {
    const next = await readStatus(check).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not reach the host. Try again.");
      return null;
    });
    if (next) {
      setError(null);
      setInfo(next);
      if (next.running) setSawRunning(true);
    }
    return next;
  }, []);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    readStatus(true)
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not reach the host. Try again.");
        return null;
      })
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

  useEffect(() => {
    if (!info?.running) return;
    const id = setInterval(() => void refresh(false), POLL_MS);
    return () => clearInterval(id);
  }, [info?.running, refresh]);

  useEffect(() => {
    if (!sawRunning || info?.running !== false || postRunRemoteCheck.current)
      return;
    postRunRemoteCheck.current = true;
    void refresh(true);
  }, [sawRunning, info?.running, refresh]);

  const start = async (rebuildOnly: boolean) => {
    setBusy(true);
    setError(null);
    postRunRemoteCheck.current = false;
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

  if (IS_DEMO) return null;
  const retry = () => {
    setChecking(true);
    void refresh(true).finally(() => setChecking(false));
  };

  if (!info) {
    return (
      <SettingsSection
        icon={<ArrowDownToLine />}
        title="Software update"
        footnote={checking ? "Checking the running build, checkout and update service." : undefined}
      >
        {checking ? <UpdateStatusSkeleton /> : <UpdateStatusUnavailable error={error} onRetry={retry} />}
      </SettingsSection>
    );
  }

  // A refusal is not an empty page. The host says exactly why this checkout
  // cannot update itself (wrong branch, dirty tree, no service unit); showing
  // the status card with zero actions made that look like a missing button.
  if (info.supported === false) {
    return (
      <SettingsSection
        icon={<ArrowDownToLine />}
        title="Software update"
        footnote="This host can still update from a terminal: mso update"
      >
        <UpdateStatusUnsupported
          reason={info.reason ?? "This deployment cannot update itself."}
          info={info}
          onRetry={retry}
        />
      </SettingsSection>
    );
  }

  const ahead = info.ahead ?? 0;
  const behind = info.behind ?? 0;
  const running = info.running ?? false;
  const pending = (info.pendingBuild ?? false) && behind === 0;
  const finished =
    sawRunning && !running
      ? info.log.includes(OK_MARKER)
        ? "ok"
        : "failed"
      : null;

  return (
    <SettingsSection
      icon={<ArrowDownToLine />}
      title="Software update"
      footnote="Pulls origin/main, verifies compile and mandatory browser journeys out-of-tree, then builds and restarts. The running build is not replaced until those checks pass."
    >
      <UpdateStatusCard
        info={info}
        checking={checking}
        sawRunning={sawRunning}
        error={error}
        finished={finished}
      />

      {/* Opt-in nightly updates. Rendered inside the same SettingsSection because it
          reads as settings rows, not as a second card. */}
      <UpdateAutomationCard />

      {behind > 0 && ahead === 0 && (
        <SettingsActionRow
          label={
            running
              ? "Updating…"
              : `Update to ${info.commits[0]?.sha ?? "latest"} and restart`
          }
          icon={<ArrowDownToLine />}
          busy={busy || running}
          disabled={running}
          onClick={() => void start(false)}
        />
      )}
      {(
        <SettingsActionRow
          label="Release notes and docs"
          icon={<BookOpen />}
          onClick={() => setNotes(true)}
          trailing={
            behind > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                {behind} new
              </span>
            ) : undefined
          }
        />
      )}
      {!running && (
        <SettingsActionRow
          label="Check again"
          icon={<Search />}
          busy={checking}
          onClick={retry}
        />
      )}
      {behind === 0 && (
        <SettingsActionRow
          label={
            pending
              ? `Build ${info.current} and restart`
              : "Rebuild and restart"
          }
          icon={<RefreshCw />}
          busy={busy || running}
          disabled={running}
          onClick={() => void start(true)}
        />
      )}

      <UpdateNotesDrawer
        open={notes}
        onOpenChange={setNotes}
        behind={behind}
        commits={info.commits ?? []}
      />
    </SettingsSection>
  );
}

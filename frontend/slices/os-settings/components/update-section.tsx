"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, BookOpen, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";
import { SettingsActionRow, SettingsSection } from "@/features/shell-settings";
import { IS_DEMO } from "@/lib/demo";
import type { UpdateStatus } from "@/lib/host/self-update";
import { UpdateNotes } from "./update-notes";
import { UpdateStatusCard, UpdateStatusSkeleton } from "./update-status-card";

// Settings → About → Update. The public route only starts the user-scoped updater;
// the updater itself proves the candidate build before the running service is replaced.
const POLL_MS = 3_000;
const OK_MARKER = "UPDATE OK";

async function readStatus(check: boolean): Promise<UpdateStatus | null> {
  const res = await fetch(`/api/v1/sys/update${check ? "" : "?check=0"}`, {
    cache: "no-store",
  });
  return res.ok ? ((await res.json()) as UpdateStatus) : null;
}

export function UpdateSection() {
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  const [sawRunning, setSawRunning] = useState(false);
  const postRunRemoteCheck = useRef(false);

  const refresh = useCallback(async (check: boolean) => {
    const next = await readStatus(check).catch(() => null);
    if (next) {
      setInfo(next);
      if (next.running) setSawRunning(true);
    }
    return next;
  }, []);

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

  if (IS_DEMO || (!info && !checking)) return null;
  if (!info && checking) {
    return (
      <SettingsSection
        icon={<ArrowDownToLine />}
        title="Software update"
        footnote="Checking the running build, checkout and update service."
      >
        <UpdateStatusSkeleton />
      </SettingsSection>
    );
  }

  if (!info) return null;
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
      footnote={
        info.supported === false
          ? (info.reason ?? undefined)
          : "Pulls origin/main, verifies compile and mandatory browser journeys out-of-tree, then builds and restarts. The running build is not replaced until those checks pass."
      }
    >
      <UpdateStatusCard
        info={info}
        checking={checking}
        sawRunning={sawRunning}
        error={error}
        finished={finished}
      />

      {behind > 0 && ahead === 0 && info.supported !== false && (
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
      {info.supported !== false && (
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
      {info.supported !== false && !running && (
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
      {info.supported !== false && behind === 0 && (
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

      <FormDrawer open={notes} onOpenChange={setNotes} size="lg">
        <FormDrawer.Header>
          <FormDrawer.Title>
            {behind > 0 ? `What's in this update (${behind})` : "Release notes"}
          </FormDrawer.Title>
          <FormDrawer.Description>
            Incoming commits first, then everything already shipped to this
            deployment.
          </FormDrawer.Description>
        </FormDrawer.Header>
        <UpdateNotes commits={info.commits ?? []} />
        <FormDrawer.Footer>
          <Button type="button" variant="ghost" onClick={() => setNotes(false)}>
            Close
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </SettingsSection>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { MoonStar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { IS_DEMO } from "@/lib/demo";
import { SettingsRow as Row, SettingsValueRow } from "@/features/shell-settings";
import {
  automationDisabledReason,
  describeLastAttempt,
  readAutomation,
  writeAutomation,
  type AutomationView,
} from "./update-automation-client";

/**
 * Opt-in unattended updates + channel. Mounts INSIDE the Updates card, so it
 * renders rows rather than another card. Every value it shows comes from the host
 * (pref + the REAL timer unit state), never from local state: a stored `auto:true`
 * with a deleted unit must read "off".
 */
export function UpdateAutomationCard() {
  const [view, setView] = useState<AutomationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => readAutomation().then((next) => { setView(next); setError(null); }, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not read update automation.");
    }),
    [],
  );

  useEffect(() => {
    if (!IS_DEMO) void load();
  }, [load]);

  const save = async (patch: { auto?: boolean; channel?: "stable" | "main" }) => {
    setBusy(true);
    try {
      setView(await writeAutomation(patch));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save automatic updates.");
      // The host refused (unsupported checkout, missing timer): re-read so the
      // switch snaps back to the truth instead of showing the click.
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (IS_DEMO) return null;

  const blocked = automationDisabledReason(view);
  const active = view?.active === true;
  const channel = view?.prefs.channel ?? "stable";

  return (
    <>
      <Row label="Update automatically at night">
        <Switch
          checked={active}
          disabled={busy || blocked !== null || view === null}
          onCheckedChange={(next) => void save({ auto: next })}
          aria-label="Update automatically at night"
        />
      </Row>
      <Row label="Update channel">
        <Select
          value={channel}
          disabled={busy || blocked !== null || view === null}
          onValueChange={(next) => void save({ channel: next === "main" ? "main" : "stable" })}
        >
          <SelectTrigger className="w-44" aria-label="Update channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stable">Stable releases</SelectItem>
            <SelectItem value="main">Rolling main</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <SettingsValueRow
        label="Nightly timer"
        value={
          view === null
            ? "checking…"
            : active
              ? `scheduled${view.timer.nextRun ? ` · next ${view.timer.nextRun}` : ""}`
              : view.timer.installed
                ? "installed but not enabled"
                : "not installed"
        }
      />
      <SettingsValueRow label="Last automatic attempt" value={describeLastAttempt(view?.last)} />

      <div className="px-4 pb-3 text-[11px] leading-relaxed text-muted-foreground">
        {blocked ? (
          <p role="note" className="text-destructive-text">{blocked}</p>
        ) : (
          <p className="flex gap-1.5">
            <MoonStar className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Runs between 04:30 and 04:55 with a random delay. It refuses on a dirty
              checkout, a running update, or two failed builds in a row, and never
              applies a commit that changes the updater itself.
              {channel === "stable"
                ? " Stable updates to the newest release tag; if no tag exists yet it follows main."
                : " Rolling main applies every commit on main."}
            </span>
          </p>
        )}
        {view?.drift && <p role="alert" className="mt-1.5 text-amber-500">{view.drift}</p>}
        {error && <p role="alert" className="mt-1.5 text-destructive-text">{error}</p>}
      </div>
    </>
  );
}

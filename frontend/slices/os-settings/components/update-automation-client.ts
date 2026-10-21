import type { AutoUpdateResult } from "@/lib/prefs/auto-update-state";
import type { PrefUpdates } from "@/lib/prefs/updates";

/** Shape of GET/POST /api/v1/sys/update/automation. `active` is the intersection of
 *  the pref and the REAL timer unit — never the pref alone. */
export interface AutomationView {
  prefs: PrefUpdates;
  timer: { installed: boolean; enabled: boolean; active: boolean; nextRun: string | null };
  active: boolean;
  last: {
    lastAttemptAt: number | null;
    lastResult: AutoUpdateResult | null;
    consecutiveFailures: number;
    detail: string | null;
    channel: "stable" | "main" | null;
  };
  drift: string | null;
  supported: boolean;
  reason: string | null;
}

export async function readAutomation(): Promise<AutomationView> {
  const res = await fetch("/api/v1/sys/update/automation", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403
    ? "Sign in as an Owner to change automatic updates."
    : `Could not read update automation (HTTP ${res.status}).`);
  return (await res.json()) as AutomationView;
}

export async function writeAutomation(patch: { auto?: boolean; channel?: "stable" | "main" }): Promise<AutomationView> {
  const res = await fetch("/api/v1/sys/update/automation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ updates: patch }),
    cache: "no-store",
    signal: AbortSignal.timeout(50_000),
  });
  const body = (await res.json().catch(() => ({}))) as AutomationView & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Could not save automatic updates (HTTP ${res.status}).`);
  return body;
}

/** The timer is off for a reason the operator cannot fix from this screen. */
export function automationDisabledReason(view: Pick<AutomationView, "supported" | "reason"> | null): string | null {
  if (view && view.supported === false) {
    return `${view.reason ?? "This deployment cannot update itself."} Automatic updates stay off until the checkout can update.`;
  }
  return null;
}

const RESULTS: Record<AutoUpdateResult, string> = { ok: "succeeded", failed: "failed", skipped: "skipped" };

export function describeLastAttempt(last: AutomationView["last"] | undefined): string {
  if (!last?.lastAttemptAt) return "No automatic attempt yet.";
  const when = new Date(last.lastAttemptAt).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const result = last.lastResult ? RESULTS[last.lastResult] : "finished";
  const pause = last.consecutiveFailures >= 2 ? " Paused after 2 failed builds." : "";
  return `Last attempt ${when} — ${result}.${pause}`;
}

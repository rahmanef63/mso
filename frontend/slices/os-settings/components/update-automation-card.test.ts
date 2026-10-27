import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describeLastAttempt, automationDisabledReason } from "./update-automation-client";

const dir = __dirname;
const card = readFileSync(path.join(dir, "update-automation-card.tsx"), "utf8");

const last = (over: Partial<Parameters<typeof describeLastAttempt>[0]> = {}) => ({
  lastAttemptAt: Date.UTC(2026, 9, 21, 4, 31, 9),
  lastResult: "failed" as const,
  consecutiveFailures: 1,
  detail: "FAILED: in-place build failed",
  channel: "stable" as const,
  ...over,
});

describe("update automation panel", () => {
  it("never claims the timer is on when the host says it is not", () => {
    // The card must read `active` (pref AND a real, enabled unit), never `prefs.auto`.
    expect(card).toContain("view?.active === true");
    expect(card).toContain("installed but not enabled");
    expect(card).toContain("not installed");
  });

  it("disables the controls and explains why when the host cannot update", () => {
    const reason = automationDisabledReason({ supported: false, reason: "software updates require the checkout to be on main (current: feat/x)" });
    expect(reason).toContain("on main");
    expect(reason).toContain("stay off");
    expect(card).toContain("disabled={busy || blocked !== null || view === null}");
    expect(card).toContain('role="note"');
    expect(automationDisabledReason({ supported: true, reason: null })).toBeNull();
    expect(automationDisabledReason(null)).toBeNull();
  });

  it("reports the last unattended attempt and surfaces the two-failure pause", () => {
    expect(describeLastAttempt(last())).toBe("Last attempt 2026-10-21 04:31:09 UTC: failed.");
    expect(describeLastAttempt(last({ consecutiveFailures: 2 }))).toContain("Paused after 2 failed builds");
    expect(describeLastAttempt(last({ lastResult: "ok", consecutiveFailures: 0 }))).toContain("succeeded");
    expect(describeLastAttempt(last({ lastAttemptAt: null }))).toBe("No automatic attempt yet.");
  });

  it("names the updater rule and the honest stable fallback in the copy", () => {
    expect(card).toContain("never");
    expect(card).toContain("updater itself");
    expect(card).toContain("no tag exists yet");
  });
});

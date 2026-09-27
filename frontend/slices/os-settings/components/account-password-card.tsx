"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IS_DEMO } from "@/lib/demo";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import type { DeviceRole } from "@/lib/auth/roles";
import type { SessionStatus } from "@/features/auth";

const MESSAGES: Record<string, string> = {
  bad_current: "Current password is incorrect.",
  mismatch: "New password and confirmation do not match.",
  weak_password: "Use 6–128 letters, numbers, or basic symbols. Spaces, quotes, and $ are not accepted.",
  unchanged: "Choose a different password.",
  password_source_mismatch: "The login password is not stored in .env.local, so Settings cannot rotate it.",
  password_file_unsafe: "The password file cannot be updated safely.",
  not_configured: "Login password is not configured.",
  rate_limited: "Too many attempts. Try again in a minute.",
  invalid_body: "Enter the current password, a new password, and a confirmation.",
  owner_required: "An Owner device is required to reset the password.",
  demo: "Password reset is unavailable in this demo.",
};

export function AccountPasswordCard({ status, role }: { status: SessionStatus; role: DeviceRole | null }) {
  const owner = status === "in" && role === "owner";
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNext] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setError(MESSAGES.mismatch);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(MESSAGES[body.error ?? ""] ?? "Couldn't reset the password.");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setNotice("Password updated. This session stays signed in; use the new password next time.");
    } catch {
      setError("Couldn't reset the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection icon={<KeyRound />} title="Reset password" footnote="This changes the shared login password. It does not create a separate password store.">
      {IS_DEMO || status !== "in" || !owner ? <SettingsBlock className="space-y-3">
        <p className="text-sm text-muted-foreground">{IS_DEMO ? MESSAGES.demo : status === "loading" ? "Checking access…" : "An Owner device is required to reset the password."}</p>
        {!IS_DEMO && status === "out" ? <Button asChild className="min-h-11"><Link prefetch={false} href="/login?returnTo=%2Fsettings%3Fsection%3Daccount">Sign in</Link></Button> : null}
      </SettingsBlock> : (
        <SettingsBlock>
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <label className="block space-y-1.5 text-sm">
              <span>Current password</span>
              <Input required type="password" autoComplete="current-password" aria-label="Current password" className="h-11" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span>New password</span>
              <Input required type="password" autoComplete="new-password" aria-label="New password" className="h-11" value={newPassword} onChange={(event) => setNext(event.target.value)} />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span>Confirm new password</span>
              <Input required type="password" autoComplete="new-password" aria-label="Confirm new password" className="h-11" value={confirmPassword} onChange={(event) => setConfirm(event.target.value)} />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
            <Button type="submit" className="min-h-11" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</Button>
          </form>
        </SettingsBlock>
      )}
    </SettingsSection>
  );
}

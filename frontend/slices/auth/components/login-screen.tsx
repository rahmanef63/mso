"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { Loader2, Copy, Check, ShieldQuestion } from "lucide-react";
import { useAppearance } from "@/lib/appearance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOrCreateDeviceId, deviceLabel } from "../lib/device";
import { MsoMark } from "@/components/shared/mso-mark";

// Password-only sign-in + device approval. Correct password on a new device →
// "pending": show the device id to paste to an approver. No cookie until an
// approved device promotes it. POSTs /api/auth/login (signed-cookie session).
// `LoginCard` is the reusable content (used full-screen by LoginScreen and as a
// modal by the Settings → Server sign-in). Device-role-gated: the public shell runs on
// mock data with no sign-in; this gates access to the real server (live mode).
export function LoginCard({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const deviceId = typeof window !== "undefined" ? getOrCreateDeviceId() : "";

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, deviceId, deviceLabel: deviceLabel() }),
      });
      if (res.ok) {
        onAuthed(); // cookie set → re-check flips the session to "in"
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setBusy(false);
      if (res.status === 403 && data.error === "device_pending") {
        setPending(true);
      } else if (data.error === "not_configured") {
        setError("Sign-in isn’t configured on the server.");
      } else if (res.status === 429) {
        setError("Too many attempts. Try again later.");
      } else if (res.status === 401 || res.status === 403) {
        setError("Incorrect password.");
      } else {
        setError("Something went wrong. Try again.");
      }
    } catch {
      setBusy(false);
      setError("Couldn’t reach the server.");
    }
  }

  function copyId() {
    navigator.clipboard?.writeText(deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <MsoMark className="mx-auto size-11" />
        <h1 className="text-lg font-bold tracking-tight">Sign in to your server</h1>
        <p className="text-xs text-muted-foreground">
          {pending ? "Device awaiting approval" : "Admin password unlocks live host access (files, terminal, monitor)."}
        </p>
      </div>

      {pending ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs text-muted-foreground">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0" />
            <p>
              This device isn’t approved yet. Send the ID below to an approved
              device’s <strong>Settings → Devices</strong>, or to the owner.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-secondary px-3 py-2 font-mono text-xs">
              {deviceId}
            </code>
            <Button type="button" variant="secondary" size="icon" className="[@media(pointer:coarse)]:size-[44px]" onClick={copyId} aria-label="Copy device id">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <Button type="button" className="w-full [@media(pointer:coarse)]:min-h-[44px]" onClick={() => submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Check again
          </Button>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {/* Hidden username for a11y + password managers (single owner). */}
          <input type="text" name="username" autoComplete="username" defaultValue="owner" readOnly hidden />
          <Input
            type="password"
            required
            placeholder="password"
            aria-label="Password"
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {/* role=alert: without a live region the failure text renders silently,
              so a screen-reader user gets no signal that the password was wrong. */}
          {error && (
            <p id="login-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full [@media(pointer:coarse)]:min-h-[44px]" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Unlock
          </Button>
        </form>
      )}
    </div>
  );
}

// Full-screen sign-in (wallpaper backdrop + glass card). Kept for callers that
// still want a blocking screen (e.g. the lock feature); the app no longer gates
// the whole UI behind it — see auth-gate.tsx.
export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const { tweaks } = useAppearance();
  return (
    <div className="relative grid min-h-dvh w-full place-items-center overflow-y-auto py-8">
      <div
        className={cn(!tweaks.wallpaperStyle && `wp-${tweaks.wallpaper === "auto" ? "aurora" : tweaks.wallpaper}`, "absolute inset-0 -z-10 bg-cover bg-center")}
        style={tweaks.wallpaperStyle}
      />
      <div className="glass w-[min(380px,92vw)] rounded-2xl border border-border bg-card/80 p-6 shadow-[var(--shadow-win)]">
        <LoginCard onAuthed={onAuthed} />
      </div>
    </div>
  );
}

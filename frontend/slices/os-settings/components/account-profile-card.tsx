"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCOUNT_PRESETS, DEFAULT_ACCOUNT_PROFILE, type AccountIcon, type AccountProfile } from "@/lib/auth/account-profile-model";
import { IS_DEMO } from "@/lib/demo";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import type { DeviceRole } from "@/lib/auth/roles";
import type { SessionStatus } from "@/features/auth";
import { AccountAvatar, AccountPresetButton } from "./account-avatar";

const MAX_IMAGE_BYTES = 24 * 1024;

async function saveProfile(patch: { name?: string; icon?: AccountIcon }): Promise<AccountProfile> {
  const response = await fetch("/api/auth/account", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = (await response.json().catch(() => ({}))) as AccountProfile & { error?: string };
  if (!response.ok) throw new Error(body.error || "save_failed");
  return body;
}

export function AccountProfileCard({ status, role }: { status: SessionStatus; role: DeviceRole | null }) {
  const owner = status === "in" && role === "owner";
  const [profile, setProfile] = useState<AccountProfile>(DEFAULT_ACCOUNT_PROFILE);
  const [name, setName] = useState(DEFAULT_ACCOUNT_PROFILE.name);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (IS_DEMO || status !== "in") return;
    let alive = true;
    fetch("/api/auth/account", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as AccountProfile & { error?: string };
        if (!response.ok) throw new Error(body.error || "load_failed");
        return body;
      })
      .then((next) => {
        if (!alive) return;
        setProfile(next);
        setName(next.name);
        setLoaded(true);
      })
      .catch(() => { if (alive) { setLoaded(true); setError("Couldn't load the account profile."); } });
    return () => { alive = false; };
  }, [status]);

  async function commit(patch: { name?: string; icon?: AccountIcon }, noticeText: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await saveProfile(patch);
      setProfile(next);
      setName(next.name);
      setNotice(noticeText);
    } catch {
      setError(patch.icon ? "Couldn't change the icon." : "Couldn't rename the account.");
    } finally {
      setBusy(false);
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > MAX_IMAGE_BYTES) {
      setError("Use a PNG, JPEG, WebP, or GIF under 24 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src.startsWith("data:image/")) {
        setError("Couldn't read that image.");
        return;
      }
      void commit({ icon: { type: "image", src } }, "Icon updated.");
    };
    reader.readAsDataURL(file);
  }

  return (
    <SettingsSection icon={<UserRound />} title="Profile" footnote={owner ? "The display name and icon are for this server's owner account. They are not the login secret." : undefined}>
      {IS_DEMO ? <SettingsBlock><p className="text-sm text-muted-foreground">Account name and icon are unavailable in this demo.</p></SettingsBlock> : null}
      {!IS_DEMO && status === "loading" ? <SettingsBlock><p role="status" className="text-sm text-muted-foreground">Checking access…</p></SettingsBlock> : null}
      {!IS_DEMO && status === "out" ? <SettingsBlock className="space-y-3">
        <p className="text-sm text-muted-foreground">Sign in with an Owner device to rename the account or change its icon.</p>
        <Button asChild className="min-h-11"><Link prefetch={false} href="/login?returnTo=%2Fsettings%3Fsection%3Daccount">Sign in</Link></Button>
      </SettingsBlock> : null}
      {!IS_DEMO && status === "in" ? <SettingsBlock className="space-y-4">
        <div className="flex items-center gap-3">
          <AccountAvatar icon={profile.icon} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{error ? "Account" : loaded ? profile.name : "Loading account…"}</p>
            <p className="text-xs text-muted-foreground">{owner ? "Owner account" : "Visible to signed-in devices"}</p>
          </div>
        </div>
        {owner ? <>
          <label className="block space-y-1.5 text-sm">
            <span>Display name</span>
            <Input value={name} maxLength={40} autoComplete="nickname" aria-label="Display name" className="h-11" onChange={(event) => setName(event.target.value)} />
          </label>
          <Button type="button" className="min-h-11" disabled={busy || name.trim() === profile.name} onClick={() => void commit({ name }, "Account renamed.")}>Rename account</Button>
          <div className="space-y-2">
            <p className="text-sm">Change icon</p>
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Change icon">
              {ACCOUNT_PRESETS.map((id) => (
                <AccountPresetButton key={id} id={id} disabled={busy} pressed={profile.icon.type === "preset" && profile.icon.id === id} onSelect={(preset) => void commit({ icon: { type: "preset", id: preset } }, "Icon updated.")} />
              ))}
            </div>
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => fileRef.current?.click()}>Upload icon</Button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Upload icon" onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
        </> : <p className="text-sm text-muted-foreground">An Owner device can rename this account or change its icon.</p>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      </SettingsBlock> : null}
    </SettingsSection>
  );
}

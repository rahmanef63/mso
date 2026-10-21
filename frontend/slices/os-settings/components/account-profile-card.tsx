"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCOUNT_PRESETS, DEFAULT_ACCOUNT_PROFILE, type AccountIcon, type AccountProfile } from "@/lib/auth/account-profile-model";
import { IS_DEMO } from "@/lib/demo";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { IconPickerPopover } from "@/features/icon-picker";
import type { DeviceRole } from "@/lib/auth/roles";
import type { SessionStatus } from "@/features/auth";
import { AccountAvatar, AccountPresetButton, libraryValueFromPicker, pickerValueFromLibrary } from "./account-avatar";

// The route caps the raw upload at 8 MiB, but proxy.ts (and scripts/server.mjs)
// reject any body over 1 MiB before a route runs, so a phone photo is pre-shrunk
// here. This is a transport optimisation only: the server decodes and re-encodes
// what it stores, and the client's bytes are never trusted.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Mirror of `PROXY_BODY_LIMIT` in scripts/server-body-policy.mjs. */
const TRANSPORT_LIMIT_BYTES = 1024 * 1024;
const PRESHRINK_MAX_EDGE = 1024;
const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

/** Downscale + re-encode in the browser so the upload clears the proxy body
 *  limit. Falls back to the original file when canvas is unavailable. */
async function preshrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, PRESHRINK_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    for (const quality of [0.9, 0.75, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size > 0 && blob.size < file.size) return blob;
    }
    return file;
  } catch {
    return file;
  }
}


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

async function uploadIcon(file: File): Promise<AccountProfile> {
  const shrunk = await preshrink(file);
  // proxy.ts rejects any body over 1 MiB before the route sees it, so surface the
  // real reason here instead of a bare 413 from middleware.
  if (shrunk.size > TRANSPORT_LIMIT_BYTES) throw new Error("too_large");
  const response = await fetch("/api/auth/account/icon", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": shrunk.type || "image/webp" },
    body: shrunk,
  });
  const body = (await response.json().catch(() => ({}))) as AccountProfile & { error?: string };
  if (!response.ok) throw new Error(body.error || "upload_failed");
  return body;
}

const UPLOAD_ERROR: Record<string, string> = {
  too_large: "That image is too large to upload. Pick a smaller one.",
  too_many_pixels: "That image has too many pixels to convert safely.",
  unsupported_type: "Use a PNG, JPEG, WebP, GIF, or AVIF.",
  invalid_image: "Couldn't decode that image.",
  owner_required: "Only an Owner device can change the icon.",
  request_too_large: "That image is too large to upload. Pick a smaller one.",
};

export function AccountProfileCard({ status, role }: { status: SessionStatus; role: DeviceRole | null }) {
  const owner = status === "in" && role === "owner";
  const [profile, setProfile] = useState<AccountProfile>(DEFAULT_ACCOUNT_PROFILE);
  const [name, setName] = useState(DEFAULT_ACCOUNT_PROFILE.name);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [classic, setClassic] = useState(false);
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

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    if (!UPLOAD_TYPES.includes(file.type)) { setError(UPLOAD_ERROR.unsupported_type!); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError(UPLOAD_ERROR.too_large!); return; }
    setBusy(true);
    try {
      const next = await uploadIcon(file);
      setProfile(next);
      setName(next.name);
      setNotice("Icon updated.");
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(UPLOAD_ERROR[code] ?? "Couldn't convert that image.");
    } finally {
      setBusy(false);
    }
  }

  /** The picker emits bare glyphs for emoji; the store needs the `emoji:` namespace. */
  function onPickIcon(next: string) {
    const value = libraryValueFromPicker(next);
    if (!value || value === "emoji:") return;
    void commit({ icon: { type: "library", value } }, "Icon updated.");
  }

  const pickerValue = profile.icon.type === "library" ? pickerValueFromLibrary(profile.icon.value) : null;

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
            <div className="flex flex-wrap items-center gap-2">
              <IconPickerPopover value={pickerValue} onChange={onPickIcon} onClear={() => void commit({ icon: { type: "preset", id: "user" } }, "Icon reset.")}>
                <Button type="button" variant="secondary" className="min-h-11" disabled={busy}>Choose icon…</Button>
              </IconPickerPopover>
              <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => fileRef.current?.click()}>Upload image</Button>
              <input ref={fileRef} type="file" accept={UPLOAD_TYPES.join(",")} className="sr-only" aria-label="Upload icon" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
            <Button type="button" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" aria-expanded={classic} onClick={() => setClassic((open) => !open)}>
              {classic ? "Hide classic icons" : "Classic icons"}
            </Button>
            {classic ? (
              <div className="grid grid-cols-4 gap-2" role="group" aria-label="Classic icons">
                {ACCOUNT_PRESETS.map((id) => (
                  <AccountPresetButton key={id} id={id} disabled={busy} pressed={profile.icon.type === "preset" && profile.icon.id === id} onSelect={(preset) => void commit({ icon: { type: "preset", id: preset } }, "Icon updated.")} />
                ))}
              </div>
            ) : null}
          </div>
        </> : <p className="text-sm text-muted-foreground">An Owner device can rename this account or change its icon.</p>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      </SettingsBlock> : null}
    </SettingsSection>
  );
}

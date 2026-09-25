"use client";

import { useState } from "react";
import { DatabaseBackup, ShieldCheck, Search } from "lucide-react";
import { SettingsSection, SettingsActionRow, SettingsValueRow, SettingsBlock } from "@/features/shell-settings";
import type { MemoryBackupSummary, MemoryBackupVerification, MemoryBackupScan } from "@/lib/contracts/memory-backup";

type Preview = { scan: MemoryBackupScan; sourceDiscoveryTruncated: boolean; sourceCount: number; scope: string; directory: string };
async function request<T>(body?: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/v1/sys/memory-backup", {
    cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Memory backup failed (${response.status})`);
  return value;
}
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function ServerBackupSection() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [snapshot, setSnapshot] = useState<MemoryBackupSummary | null>(null);
  const [verification, setVerification] = useState<MemoryBackupVerification | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const perform = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Operation failed"); }
    finally { setBusy(null); }
  };
  return <SettingsSection icon={<DatabaseBackup />} title="Server memory backup" footnote="Owner-only local snapshots of available memory, sessions, workflow and organization data. Not a full VPS/database backup or an offsite copy. Private content stays on the server. Restore check writes a new isolated folder; it never replaces sources or authorizes cleanup.">
    <SettingsActionRow label="Preview server memory sources" icon={<Search />} busy={busy === "preview"} disabled={busy !== null} onClick={() => void perform("preview", async () => setPreview(await request<Preview>()))} />
    {preview ? <>
      <SettingsValueRow label="Available files" value={`${preview.scan.files} · ${size(preview.scan.bytes)}`} />
      <SettingsValueRow label="Scope" value={preview.scan.truncated || preview.sourceDiscoveryTruncated ? "Partial scan — not a complete backup" : "Bounded allowlisted sources"} />
      <SettingsValueRow label="Missing / rejected / excluded" value={`${preview.scan.missing} / ${preview.scan.rejected} / ${preview.scan.excluded}`} />
      <SettingsActionRow label="Create local memory snapshot" icon={<DatabaseBackup />} busy={busy === "create"} disabled={busy !== null || preview.scan.files === 0} onClick={() => void perform("create", async () => { setVerification(null); setSnapshot(await request<MemoryBackupSummary>({ action: "create", confirm: true })); })} />
    </> : null}
    {snapshot ? <>
      <SettingsValueRow label="Snapshot" value={`${snapshot.state} · ${snapshot.scan.files} files · ${size(snapshot.compressedBytes)}`} />
      <SettingsBlock><p className="break-all text-xs text-muted-foreground">{snapshot.directory}</p><p className="mt-1 break-all font-mono text-xs">Manifest SHA-256: {snapshot.manifestSha256}</p></SettingsBlock>
      <SettingsActionRow label="Verify checksum and rehearse restore" icon={<ShieldCheck />} busy={busy === "verify"} disabled={busy !== null} onClick={() => void perform("verify", async () => setVerification(await request<MemoryBackupVerification>({ action: "verify", id: snapshot.id, manifest_sha256: snapshot.manifestSha256, confirm: true })))} />
    </> : null}
    {verification ? <SettingsValueRow label="Restore verification" value={`${verification.restoredFiles} files verified · ${verification.complete ? "captured scope complete" : "partial snapshot only"} · source writes: ${verification.sourceWritesPerformed}`} /> : null}
    {error ? <SettingsBlock><p role="alert" className="text-xs text-destructive-text">{error}</p></SettingsBlock> : null}
  </SettingsSection>;
}

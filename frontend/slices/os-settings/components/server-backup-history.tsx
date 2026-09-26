"use client";
import { Fragment, useState } from "react";
import { Archive, RefreshCw } from "lucide-react";
import { SettingsActionRow, SettingsValueRow, SettingsBlock } from "@/features/shell-settings";
import type { MemoryBackupHistory, MemoryBackupHistoryItem, MemoryBackupSummary } from "@/lib/contracts/memory-backup";
import { requestBackup } from "./server-backup-request";

export function backupHistoryLabel(item: MemoryBackupHistoryItem): string {
  if (item.status === "unreadable") return "Snapshot metadata unreadable — not an empty backup";
  const coverage = item.snapshot.state === "partial" ? "Partial snapshot" : "Captured allowlist complete";
  const integrity = item.integrity === "verified-at-recorded-time" ? `Integrity recorded ${item.verifiedAt}`
    : item.integrity === "receipt-invalid" ? "Invalid integrity receipt — recheck required" : "No saved integrity receipt";
  return `${coverage} · ${item.snapshot.scan.files} files · ${integrity}`;
}
export function ServerBackupHistory({ disabled, onSelect }: { disabled: boolean; onSelect: (snapshot: MemoryBackupSummary) => void }) {
  const [page, setPage] = useState<MemoryBackupHistory | null>(null);
  const [items, setItems] = useState<MemoryBackupHistoryItem[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = async (more = false) => {
    setBusy(true); setError("");
    try {
      const query: Record<string, string> = { view: "history" };
      if (more && page?.nextOffset != null) { query.offset = String(page.nextOffset); query.revision = page.revision; }
      const next = await requestBackup<MemoryBackupHistory>(undefined, query);
      setPage(next);
      setItems((current) => more ? [...current, ...next.items.filter(row => !current.some(old => old.id === row.id))] : next.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Snapshot history unavailable"); }
    finally { setBusy(false); }
  };
  return <>
    <SettingsActionRow label={page ? "Refresh saved server snapshots" : "Load saved server snapshots"} icon={<RefreshCw />} busy={busy} disabled={disabled || busy} onClick={() => void load()} />
    {page && items.length === 0 && !error ? <SettingsValueRow label="Saved snapshots" value={page.nextOffset === null ? "No saved snapshots" : "No snapshots in this page — load more"} /> : null}
    {items.map(item => item.status === "readable"
      ? <Fragment key={item.id}>
        <SettingsActionRow label={`${item.snapshot.createdAt} · ${item.id.slice(0, 8)}`} icon={<Archive />} disabled={disabled || busy} onClick={() => onSelect(item.snapshot)} />
        <SettingsBlock><p className="break-words text-xs text-muted-foreground">{backupHistoryLabel(item)}</p></SettingsBlock>
      </Fragment>
      : <SettingsBlock key={item.id}><p className="break-words text-xs text-muted-foreground">{item.id.slice(0, 8)}: {backupHistoryLabel(item)}</p></SettingsBlock>)}
    {page?.nextOffset != null ? <SettingsActionRow label="Load more saved snapshots" busy={busy} disabled={disabled || busy} onClick={() => void load(true)} /> : null}
    {page ? <SettingsBlock><p className="text-xs text-muted-foreground">Saved metadata in directory order, not a new integrity check. Same-server copies only; no offsite or point-in-time guarantee. Old snapshots may predate persistent integrity receipts. Select one to run a new isolated restore check.</p></SettingsBlock> : null}
    {error ? <SettingsBlock><p role="alert" className="text-xs text-destructive-text">{error}</p></SettingsBlock> : null}
  </>;
}

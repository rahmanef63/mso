"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { IS_DEMO } from "@/lib/demo";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";
import { SettingsSection, SettingsValueRow, SettingsActionRow } from "@/features/shell-settings";

type Item = { id: string; label: string; desc: string; bytes: number; available: boolean };
type Preview = { items: Item[]; preview: { id: string; expiresAt: string }; protected: string[] };
type Result = { id: string; ok: boolean; freedBytes: number; error?: string };
function fmt(n: number): string {
  if (n < 1e3) return `${n} B`;
  if (n < 1e6) return `${Math.round(n / 1e3)} kB`;
  if (n < 1e9) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

export function CleanupSection() {
  const [data, setData] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"scan" | "clean" | null>("scan");
  const [confirming, setConfirming] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchPreview = useCallback(async (): Promise<Preview> => {
    const response = await fetch("/api/v1/sys/cleanup", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `scan failed (${response.status})`);
    return body;
  }, []);
  const applyPreview = useCallback((next: Preview) => {
    setData(next); setSelected(new Set()); setBusy(null);
  }, []);
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    fetchPreview().then((next) => { if (alive) applyPreview(next); }, (cause: unknown) => {
      if (alive) { setError(cause instanceof Error ? cause.message : "Preview unavailable"); setBusy(null); }
    });
    return () => { alive = false; };
  }, [fetchPreview, applyPreview]);
  const rescan = () => {
    setBusy("scan"); setError(null);
    fetchPreview().then(applyPreview, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Preview unavailable"); setBusy(null);
    });
  };
  const clean = async () => {
    if (!data) return;
    setConfirming(false); setBusy("clean"); setError(null); setFreed(null);
    try {
      const response = await fetch("/api/v1/sys/cleanup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selected], preview_id: data.preview.id, confirm: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `cleanup failed (${response.status})`);
      const results = body.results as Result[];
      setFreed(results.reduce((sum, result) => sum + result.freedBytes, 0));
      const failed = results.filter((result) => !result.ok);
      if (failed.length) setError(`Not completed: ${failed.map((result) => result.id).join(", ")}`);
      applyPreview(await fetchPreview());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cleanup failed"); setBusy(null); }
  };
  const choices = (data?.items ?? []).filter((item) => selected.has(item.id));
  const selectedBytes = choices.reduce((sum, item) => sum + item.bytes, 0);
  if (IS_DEMO) return <SettingsSection icon={<Trash2 />} title="Cleanup" footnote="Preview and cleanup are disabled in the demo."><SettingsValueRow label="Status" value="Disabled in demo" /></SettingsSection>;
  return <>
    <SettingsSection icon={<Trash2 />} title="Cleanup" footnote="Nothing is selected automatically. Estimates may exceed actual reclaimed space. Trash and old logs are irreversible; broad temporary-file cleanup is blocked. Session records, memory stores and volumes are not cleanup targets.">
      <SettingsValueRow label="Session evidence" value="Automatic session-source deletion disabled" />
      {busy === "scan" ? <SettingsValueRow label="Scanning…" value="Preparing a fresh preview" /> : null}
      {data?.items.map((item) => <div key={item.id} data-slot="settings-row" className="flex min-h-[46px] items-center gap-3 border-b px-4 py-3 last:border-b-0">
        <div className="min-w-0 flex-1"><p className="text-sm">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{item.available ? fmt(item.bytes) : "Protected / unavailable"}</span>
        <Switch checked={selected.has(item.id)} disabled={!item.available || busy !== null} aria-label={`Include ${item.label}`} onCheckedChange={(on) => setSelected((prior) => { const next = new Set(prior); if (on) next.add(item.id); else next.delete(item.id); return next; })} />
      </div>)}
      {freed !== null ? <SettingsValueRow label="Last cleanup freed" value={fmt(freed)} /> : null}
      {error ? <SettingsValueRow label="Problem" value={error} /> : null}
      <SettingsActionRow label={selected.size ? `Review ${selected.size} categories — up to ${fmt(selectedBytes)}` : "Select categories to review"} icon={<Trash2 />} onClick={() => setConfirming(true)} busy={busy === "clean"} disabled={!selected.size || busy !== null} />
      <SettingsActionRow label="Rescan" icon={<RefreshCw />} onClick={rescan} busy={busy === "scan"} disabled={busy !== null} />
    </SettingsSection>
    <FormDrawer open={confirming} onOpenChange={setConfirming} size="sm">
      <FormDrawer.Header><FormDrawer.Title>Confirm selected cleanup</FormDrawer.Title><FormDrawer.Description>Only the selected categories below will run. This does not back up your VPS. Preview expires after five minutes.</FormDrawer.Description></FormDrawer.Header>
      <FormDrawer.Body><div className="space-y-2 text-sm">{choices.map((item) => <p key={item.id}>{item.label} — up to {fmt(item.bytes)}</p>)}<p className="text-xs text-muted-foreground">Preserved: {data?.protected.join(", ")}. Do not treat logs or Trash as recoverable caches.</p></div></FormDrawer.Body>
      <FormDrawer.Footer><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button><Button variant="destructive" onClick={() => void clean()}>Confirm cleanup</Button></FormDrawer.Footer>
    </FormDrawer>
  </>;
}

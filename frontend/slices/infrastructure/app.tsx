"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Cloud, Loader2, RefreshCw, Save, ServerCog, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InfrastructureFeatureId } from "./index";

type Field = { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; description: string };
type Provider = { id: string; title: string; description: string; configured: boolean; missing: string[]; values: Record<string, string>; fields: Field[] };
type Doctor = { id: string; ok: boolean | null; detail: string };

type RemoteItem = { id: string; name: string };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function InfrastructureProviderApp({ provider }: { provider: InfrastructureFeatureId }) {
  const [meta, setMeta] = useState<Provider | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [items, setItems] = useState<RemoteItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await json<{ providers: Provider[] }>("/api/v1/infra/providers");
      setError("");
      const row = data.providers.find((entry) => entry.id === provider) ?? null;
      setMeta(row);
      if (row) setForm((current) => Object.fromEntries(row.fields.map((field) => [field.key, current[field.key] ?? (field.secret ? "" : row.values[field.key] ?? "")])))
      if (row?.configured) {
        const resource = provider === "dokploy"
          ? await json<{ projects: Array<{ projectId: string; name: string }> }>("/api/v1/infra/dokploy/projects").then((r) => r.projects.map((p) => ({ id: p.projectId, name: p.name })))
          : await json<{ zones: RemoteItem[] }>("/api/v1/infra/cloudflare/zones").then((r) => r.zones);
        setItems(resource);
      } else setItems([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to read provider"); }
  }, [provider]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const save = async () => {
    if (!meta) return;
    setBusy(true); setError("");
    try {
      const values = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim()));
      await json("/api/v1/infra/providers", { method: "POST", body: JSON.stringify({ id: provider, values }) });
      const checked = await json<{ results: Doctor[] }>("/api/v1/infra/providers/doctor", { method: "POST", body: JSON.stringify({ id: provider }) });
      setDoctor(checked.results[0] ?? null);
      setForm((current) => ({ ...current, ...(meta.fields.filter((field) => field.secret).reduce((acc, field) => ({ ...acc, [field.key]: "" }), {}) as Record<string, string>) }));
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save provider"); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setError("");
    try {
      const checked = await json<{ results: Doctor[] }>("/api/v1/infra/providers/doctor", { method: "POST", body: JSON.stringify({ id: provider }) });
      setDoctor(checked.results[0] ?? null);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Provider verification failed"); }
    finally { setBusy(false); }
  };

  const Icon = provider === "dokploy" ? ServerCog : Cloud;
  const remoteLabel = provider === "dokploy" ? "Projects" : "Zones";
  const summary = useMemo(() => meta?.configured ? "Configured" : meta ? `Missing ${meta.missing.join(", ")}` : "Loading", [meta]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[color:var(--window-bg)] text-[color:var(--text)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--separator)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-[color:var(--inset)]"><Icon className="size-4.5" /></div>
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{meta?.title ?? (provider === "dokploy" ? "Dokploy" : "Cloudflare")}</h2><p className="truncate text-[11px] text-[color:var(--text-dim)]">{summary}</p></div>
        </div>
        <div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => void verify()} disabled={busy || !meta?.configured}><ShieldCheck className="size-3.5" /> Verify</Button><Button size="sm" onClick={() => void save()} disabled={busy || !meta}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save</Button></div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,.95fr)]">
          <section className="rounded-xl border border-[color:var(--separator)] bg-[color:var(--surface)] p-4">
            <div className="mb-4"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-dim)]">Connection</h3><p className="mt-1 text-xs text-[color:var(--text-dim)]">{meta?.description}</p></div>
            <div className="space-y-3">
              {meta?.fields.map((field) => <label key={field.key} className="block"><span className="mb-1 flex items-center justify-between text-xs font-medium"><span>{field.label}{field.required ? " *" : ""}</span>{meta.values[field.key] && <span className="text-[10px] font-normal text-[color:var(--text-dim)]">current: {meta.values[field.key]}</span>}</span><input type={field.secret ? "password" : "text"} autoComplete="off" value={form[field.key] ?? ""} placeholder={field.secret && meta.values[field.key] ? "Leave blank to keep current secret" : field.placeholder ?? ""} onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))} className="h-9 w-full rounded-lg border border-[color:var(--separator)] bg-[color:var(--inset)] px-3 text-xs outline-none focus:border-[color:var(--accent)]" /><span className="mt-1 block text-[10px] leading-4 text-[color:var(--text-faint)]">{field.description}</span></label>)}
            </div>
            {doctor && <div className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${doctor.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>{doctor.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />}<span>{doctor.detail}</span></div>}
            {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-500" /><span>{error}</span></div>}
          </section>

          <section className="rounded-xl border border-[color:var(--separator)] bg-[color:var(--surface)] p-4">
            <div className="mb-3 flex items-center justify-between"><div><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-dim)]">{remoteLabel}</h3><p className="mt-1 text-[10px] text-[color:var(--text-faint)]">Live read from the configured provider.</p></div><Button size="sm" variant="ghost" onClick={() => void refresh()}><RefreshCw className="size-3.5" /></Button></div>
            {!meta?.configured ? <p className="rounded-lg bg-[color:var(--inset)] p-3 text-xs text-[color:var(--text-dim)]">Configure the required fields first.</p> : items.length ? <div className="space-y-1.5">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-[color:var(--inset)] px-3 py-2"><span className="truncate text-xs font-medium">{item.name}</span><code className="max-w-[45%] truncate text-[10px] text-[color:var(--text-faint)]">{item.id}</code></div>)}</div> : <p className="rounded-lg bg-[color:var(--inset)] p-3 text-xs text-[color:var(--text-dim)]">No {remoteLabel.toLowerCase()} returned.</p>}
            <div className="mt-4 rounded-lg border border-[color:var(--separator)] p-3 text-[10px] leading-4 text-[color:var(--text-dim)]">MSO Agent uses the same provider state through bounded tools. Secrets stay server-side and are never included in model tool arguments.</div>
          </section>
        </div>
      </div>
    </div>
  );
}

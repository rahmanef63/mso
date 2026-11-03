"use client";

import { useMemo } from "react";
import { CheckCircle2, Cloud, Loader2, RefreshCw, Save, ServerCog, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InfrastructureFeatureId } from "./index";
import { useProvider } from "./lib/use-provider";

export function InfrastructureProviderApp({ provider }: { provider: InfrastructureFeatureId }) {
  const { meta, form, setForm, doctor, items, loading, loaded, busy, error, refresh, save, verify } = useProvider(provider);

  const Icon = provider === "dokploy" ? ServerCog : Cloud;
  const remoteLabel = provider === "dokploy" ? "Projects" : "Zones";
  const summary = useMemo(() => meta?.configured ? "Configured" : meta ? `Missing ${meta.missing.join(", ")}` : "Loading", [meta]);

  return (
    <div data-slot="infrastructure-feature" className="@container flex h-full min-h-0 min-w-0 flex-col bg-[color:var(--window-bg)] text-[color:var(--text)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--separator)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-[color:var(--inset)]"><Icon className="size-4.5" /></div>
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{meta?.title ?? (provider === "dokploy" ? "Dokploy" : "Cloudflare")}</h2><p className="truncate text-[11px] text-[color:var(--text-dim)]">{summary}</p></div>
        </div>
        <div className="flex w-full items-center gap-2 @min-[480px]:w-auto"><Button size="sm" variant="outline" className="flex-1 @min-[480px]:flex-none" onClick={() => void verify()} disabled={busy || loading || !meta?.configured}><ShieldCheck className="size-3.5" /> Verify</Button><Button size="sm" className="flex-1 @min-[480px]:flex-none" onClick={() => void save()} disabled={busy || loading || !meta}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save</Button></div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid w-full max-w-5xl gap-4 @min-[760px]:grid-cols-[minmax(0,1.05fr)_minmax(280px,.95fr)]">
          <section className="rounded-xl border border-[color:var(--separator)] bg-[color:var(--surface)] p-4">
            <div className="mb-4"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-dim)]">Connection</h3><p className="mt-1 text-xs text-[color:var(--text-dim)]">{meta?.description}</p></div>
            <div className="space-y-3">
              {meta?.fields.map((field) => <label key={field.key} className="block"><span className="mb-1 flex items-center justify-between text-xs font-medium"><span>{field.label}{field.required ? " *" : ""}</span>{meta.values[field.key] && <span className="text-[10px] font-normal text-[color:var(--text-dim)]">current: {meta.values[field.key]}</span>}</span><input type={field.secret ? "password" : "text"} autoComplete="off" value={form[field.key] ?? ""} placeholder={field.secret && meta.values[field.key] ? "Leave blank to keep current secret" : field.placeholder ?? ""} onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))} className="h-9 w-full rounded-lg border border-[color:var(--separator)] bg-[color:var(--inset)] px-3 text-xs outline-none focus:border-[color:var(--accent)]" /><span className="mt-1 block text-[10px] leading-4 text-[color:var(--text-faint)]">{field.description}</span></label>)}
            </div>
            {doctor && <div className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${doctor.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>{doctor.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />}<span>{doctor.detail}</span></div>}
            {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive-text"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-500" /><span>{error}</span></div>}
          </section>

          <section className="rounded-xl border border-[color:var(--separator)] bg-[color:var(--surface)] p-4">
            <div className="mb-3 flex items-center justify-between"><div><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-dim)]">{remoteLabel}</h3><p className="mt-1 text-[10px] text-[color:var(--text-faint)]">Live read from the configured provider.</p></div><Button size="sm" variant="ghost" aria-label="Refresh inventory" title="Refresh inventory" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw className="size-3.5" /></Button></div>
            {loading && <p role="status" className="mb-3 text-xs text-muted-foreground">{loaded ? "Refreshing inventory…" : "Loading provider inventory…"}</p>}
            {error && loaded && <p role="status" className="mb-3 text-xs text-muted-foreground">Showing the last loaded inventory.</p>}
            {!meta ? <p className="text-xs text-muted-foreground">{error ? "Provider inventory is unavailable. Retry using Refresh inventory." : "Loading connection details…"}</p> : !meta.configured ? <p className="rounded-lg bg-[color:var(--inset)] p-3 text-xs text-[color:var(--text-dim)]">Configure the required fields first.</p> : items.length ? <div className="space-y-1.5">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-[color:var(--inset)] px-3 py-2"><span className="truncate text-xs font-medium">{item.name}</span><code className="max-w-[45%] truncate text-[10px] text-[color:var(--text-faint)]">{item.id}</code></div>)}</div> : loading ? null : error && !loaded ? <p className="text-xs text-muted-foreground">Inventory could not be loaded. Use Refresh inventory to retry.</p> : <p className="rounded-lg bg-[color:var(--inset)] p-3 text-xs text-[color:var(--text-dim)]">No {remoteLabel.toLowerCase()} returned.</p>}
            <div className="mt-4 rounded-lg border border-[color:var(--separator)] p-3 text-[10px] leading-4 text-[color:var(--text-dim)]">MSO Agent uses the same provider state through bounded tools. Secrets stay server-side and are never included in model tool arguments.</div>
          </section>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
// Relative (not `@/features/...`) because os-settings exports no component barrel
// and deep `@/features/*/components/*` imports warn under no-restricted-imports.
import { ProviderSelectContent } from "../../os-settings/components/provider-filter-list";
import {
  quickModelForProvider, quickProviderIds, quickProviderLabel,
  type QuickCatalogModel, type QuickConnectedProvider,
} from "./model-quick-options";

type ConfigSnapshot = { providers?: QuickConnectedProvider[] };
export type ModelLoad = { state: "loading" | "ok" | "error"; error?: string };

/** The saved model stays selectable even when the catalog omits it, so a refresh
 * never silently rewrites the user's choice. */
export function modelOptions(rows: QuickCatalogModel[], activeModel: string): QuickCatalogModel[] {
  return !activeModel || rows.some((row) => row.id === activeModel)
    ? rows
    : [{ id: activeModel, name: activeModel }, ...rows];
}

/** True when the saved model is absent from a NON-empty catalog — the provider
 * changed under us. Shown to the user instead of auto-picking another. */
export function isStaleSelection(load: ModelLoad, rows: QuickCatalogModel[], activeModel: string): boolean {
  return load.state === "ok" && rows.length > 0 && !!activeModel && !rows.some((row) => row.id === activeModel);
}

/** Non-2xx is an ERROR (never an empty list); 2xx with `models: []` honestly
 * means "this provider has none". */
export function modelsFromResponse(status: number, body: { models?: QuickCatalogModel[] }): { load: ModelLoad; rows: QuickCatalogModel[] } {
  if (status < 200 || status >= 300) return { load: { state: "error", error: `HTTP ${status}` }, rows: [] };
  return { load: { state: "ok" }, rows: Array.isArray(body.models) ? body.models : [] };
}

export function modelOptionText(row: QuickCatalogModel, activeModel: string): string {
  return `${row.name || row.id}${row.id === activeModel ? " (current)" : ""}`;
}

/** Model half of the cockpit, split out so all three states are assertable markup:
 * a failed fetch is an error + Retry (never an empty dropdown); a provider that
 * genuinely lists nothing gets an explicit Discover affordance. */
export function ModelPickerBody({
  load, rows, activeModel, provider, saving, discovering, onReload, onDiscover, onSelect,
}: {
  load: ModelLoad; rows: QuickCatalogModel[]; activeModel: string; provider: string;
  saving: boolean; discovering: boolean;
  onReload: () => void; onDiscover: () => void; onSelect: (id: string) => void;
}) {
  const link = "ml-auto h-auto p-0 text-xs underline [@media(pointer:coarse)]:min-h-[44px]";
  if (load.state === "error") {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 px-2 py-1.5 text-xs text-destructive">
        <TriangleAlert className="size-3 shrink-0" />
        <span className="truncate">Couldn’t load {quickProviderLabel(provider)} models ({load.error})</span>
        <Button type="button" variant="ghost" size="sm" className={link} onClick={onReload}>Retry</Button>
      </div>
    );
  }
  if (load.state === "ok" && rows.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
        <span className="truncate">{quickProviderLabel(provider)} reports no models.</span>
        <Button type="button" variant="ghost" size="sm" className={`${link} text-primary`} disabled={discovering} onClick={onDiscover}>{discovering ? "Discovering…" : "Discover"}</Button>
      </div>
    );
  }
  return (
    <Select value={activeModel} onValueChange={onSelect} disabled={saving || load.state !== "ok"}>
      <SelectTrigger aria-label="Alfa model"><SelectValue placeholder={load.state === "loading" ? "Loading models…" : "Choose model"} /></SelectTrigger>
      <ProviderSelectContent filterLabel="Filter Alfa models" groups={[{
        label: quickProviderLabel(provider),
        rows: modelOptions(rows, activeModel).slice(0, 80).map((row) => ({ id: row.id, text: modelOptionText(row, activeModel) })),
      }]} />
    </Select>
  );
}

// Alfa cockpit model switcher: providers use the shared bounded/filterable list
// (same cap as Settings → AI); models are that provider's real catalog from
// /api/models?provider=…, persisted with POST /api/config.
export function ModelQuickControl({ provider, model, onSaved }: { provider: string; model: string; onSaved: () => void }) {
  const [providerIds, setProviderIds] = useState<string[]>([provider]);
  const [activeProvider, setActiveProvider] = useState(provider);
  const [activeModel, setActiveModel] = useState(model);
  // Request-keyed derived state: a settled result is only valid for the provider
  // it was fetched for, so "loading" needs no setState inside the effect.
  type Result = { key: string; load: ModelLoad; rows: QuickCatalogModel[] };
  const [result, setResult] = useState<Result>({ key: "", load: { state: "loading" }, rows: [] });
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/config", { cache: "no-store", signal: ctrl.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: ConfigSnapshot | null) => body && setProviderIds(quickProviderIds(provider, body.providers ?? [])))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [provider]);

  const requestKey = `${activeProvider}#${reloadKey}`;
  const settled = result.key === requestKey ? result : null;
  const load: ModelLoad = settled?.load ?? { state: "loading" };
  const rows = settled?.rows ?? [];

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/models?provider=${encodeURIComponent(activeProvider)}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (response) => modelsFromResponse(response.status, (await response.json().catch(() => ({}))) as { models?: QuickCatalogModel[] }))
      .then((next) => setResult({ key: requestKey, ...next }))
      .catch((e: Error) => {
        if (ctrl.signal.aborted) return;
        // rows stay empty AND the state is "error": never an empty-list lie.
        setResult({ key: requestKey, load: { state: "error", error: e.message || "Model list failed to load" }, rows: [] });
      });
    return () => ctrl.abort();
  }, [activeProvider, requestKey]);

  const stale = isStaleSelection(load, rows, activeModel);

  async function save(nextProvider: string, nextModel: string) {
    const response = await fetch("/api/config", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: nextProvider, model: nextModel }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  // Key stays server-side: the route reads it from the provider's credential.
  async function discover() {
    setDiscovering(true); setTest(null);
    try {
      const response = await fetch("/api/models/discover", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: activeProvider }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; models?: QuickCatalogModel[]; error?: string };
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      const found = body.models ?? [];
      setResult({ key: requestKey, load: { state: "ok" }, rows: found });
      setTest(found.length
        ? { ok: true, text: `Found ${found.length} model${found.length === 1 ? "" : "s"} — pick one to save` }
        : { ok: false, text: "Endpoint reachable but listed no models" });
    } catch (e) { setTest({ ok: false, text: (e as Error).message || "Discovery failed" }); }
    finally { setDiscovering(false); }
  }

  async function selectProvider(nextProvider: string) {
    if (!nextProvider || nextProvider === activeProvider || saving) return;
    setSaving(true); setTest(null);
    try {
      const response = await fetch(`/api/models?provider=${encodeURIComponent(nextProvider)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextRows = (((await response.json()).models ?? []) as QuickCatalogModel[]);
      const nextModel = quickModelForProvider(nextProvider, nextRows, provider, model);
      if (!nextModel) throw new Error("No selectable model");
      await save(nextProvider, nextModel);
      setResult({ key: `${nextProvider}#${reloadKey}`, load: { state: "ok" }, rows: nextRows });
      setActiveProvider(nextProvider);
      setActiveModel(nextModel);
      onSaved();
    } catch { setTest({ ok: false, text: "Provider switch failed" }); }
    finally { setSaving(false); }
  }

  async function selectModel(nextModel: string) {
    if (!nextModel || nextModel === activeModel || saving) return;
    setSaving(true); setTest(null);
    try {
      await save(activeProvider, nextModel);
      setActiveModel(nextModel);
      onSaved();
    } catch { setTest({ ok: false, text: "Model switch failed" }); }
    finally { setSaving(false); }
  }

  async function testSelected() {
    setSaving(true); setTest(null);
    try {
      const response = await fetch("/api/models/test", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      setTest(body.ok ? { ok: true, text: "Connected" } : { ok: false, text: body.error || "Connection failed" });
    } catch { setTest({ ok: false, text: "Connection failed" }); }
    finally { setSaving(false); }
  }

  const providerGroups = useMemo(() => [{ label: "Connected",
    rows: providerIds.map((id) => ({ id, text: quickProviderLabel(id) })) }], [providerIds]);

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={activeProvider} onValueChange={selectProvider} disabled={saving}>
          <SelectTrigger aria-label="Alfa provider"><SelectValue /></SelectTrigger>
          <ProviderSelectContent groups={providerGroups} filterLabel="Filter Alfa providers" />
        </Select>
        <ModelPickerBody load={load} rows={rows} activeModel={activeModel} provider={activeProvider}
          saving={saving} discovering={discovering} onReload={() => setReloadKey((k) => k + 1)}
          onDiscover={() => void discover()} onSelect={(next) => void selectModel(next)} />
      </div>
      {stale ? <p className="text-[10px] text-warning" role="status">Saved model “{activeModel}” is not in the current list — pick another to switch, or Discover to refresh.</p> : null}
      <Button size="sm" variant="outline" className="h-9" onClick={testSelected} disabled={saving}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Test active"}
      </Button>
      {test ? <p className={`flex items-center gap-1 text-[10px] ${test.ok ? "text-success" : "text-destructive"}`}>{test.ok ? <CheckCircle2 className="size-3" /> : <TriangleAlert className="size-3" />}{test.text}</p> : null}
      <p className="text-[10px] text-muted-foreground">Switches Alfa among providers already connected in Settings. Credentials remain managed in Settings.</p>
    </div>
  );
}

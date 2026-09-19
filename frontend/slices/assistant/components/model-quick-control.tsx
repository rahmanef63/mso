"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  quickModelForProvider,
  quickProviderIds,
  quickProviderLabel,
  type QuickCatalogModel,
  type QuickConnectedProvider,
} from "./model-quick-options";

type ConfigSnapshot = { providers?: QuickConnectedProvider[] };

export function ModelQuickControl({ provider, model, onSaved }: { provider: string; model: string; onSaved: () => void }) {
  const [providerIds, setProviderIds] = useState<string[]>([provider]);
  const [activeProvider, setActiveProvider] = useState(provider);
  const [activeModel, setActiveModel] = useState(model);
  const [rows, setRows] = useState<QuickCatalogModel[]>([]);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/config", { cache: "no-store", signal: ctrl.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: ConfigSnapshot | null) => body && setProviderIds(quickProviderIds(provider, body.providers ?? [])))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [provider]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/models?provider=${encodeURIComponent(activeProvider)}`, { cache: "no-store", signal: ctrl.signal })
      .then((response) => response.ok ? response.json() : { models: [] })
      .then((body) => setRows((body.models ?? []) as QuickCatalogModel[]))
      .catch(() => setRows([]));
    return () => ctrl.abort();
  }, [activeProvider]);

  const options = useMemo(
    () => rows.some((row) => row.id === activeModel) ? rows : activeModel ? [{ id: activeModel, name: activeModel }, ...rows] : rows,
    [activeModel, rows],
  );

  async function save(nextProvider: string, nextModel: string) {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: nextProvider, model: nextModel }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  async function selectProvider(nextProvider: string) {
    if (!nextProvider || nextProvider === activeProvider || saving) return;
    setSaving(true);
    setTest(null);
    try {
      const response = await fetch(`/api/models?provider=${encodeURIComponent(nextProvider)}`, { cache: "no-store" });
      const nextRows = response.ok ? (((await response.json()).models ?? []) as QuickCatalogModel[]) : [];
      const nextModel = quickModelForProvider(nextProvider, nextRows, provider, model);
      if (!nextModel) throw new Error("No selectable model");
      await save(nextProvider, nextModel);
      setRows(nextRows);
      setActiveProvider(nextProvider);
      setActiveModel(nextModel);
      onSaved();
    } catch {
      setTest({ ok: false, text: "Provider switch failed" });
    } finally {
      setSaving(false);
    }
  }

  async function selectModel(nextModel: string) {
    if (!nextModel || nextModel === activeModel || saving) return;
    setSaving(true);
    setTest(null);
    try {
      await save(activeProvider, nextModel);
      setActiveModel(nextModel);
      onSaved();
    } catch {
      setTest({ ok: false, text: "Model switch failed" });
    } finally {
      setSaving(false);
    }
  }

  async function testSelected() {
    setSaving(true);
    setTest(null);
    try {
      const response = await fetch("/api/models/test", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      setTest(body.ok ? { ok: true, text: "Connected" } : { ok: false, text: body.error || "Connection failed" });
    } catch {
      setTest({ ok: false, text: "Connection failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={activeProvider} onValueChange={selectProvider} disabled={saving}>
          <SelectTrigger aria-label="Alfa provider"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="start">
            {providerIds.map((id) => <SelectItem key={id} value={id}>{quickProviderLabel(id)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={activeModel} onValueChange={selectModel} disabled={saving || !activeModel}>
          <SelectTrigger aria-label="Alfa model"><SelectValue placeholder="Choose model" /></SelectTrigger>
          <SelectContent position="popper" align="start">
            {options.slice(0, 80).map((row) => <SelectItem key={row.id} value={row.id}>{row.name || row.id}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" variant="outline" className="h-9" onClick={testSelected} disabled={saving}>
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Test active"}
      </Button>
      {test ? <p className={`flex items-center gap-1 text-[10px] ${test.ok ? "text-success" : "text-destructive"}`}>{test.ok ? <CheckCircle2 className="size-3" /> : <TriangleAlert className="size-3" />}{test.text}</p> : null}
      <p className="text-[10px] text-muted-foreground">Switches Alfa among providers already connected in Settings. Credentials remain managed in Settings.</p>
    </div>
  );
}

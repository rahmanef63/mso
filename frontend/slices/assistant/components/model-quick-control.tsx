"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CatalogModel = { id: string; name?: string; tools?: boolean; reasoning?: boolean; vision?: boolean };

export function ModelQuickControl({ provider, model, onSaved }: { provider: string; model: string; onSaved: () => void }) {
  const [rows, setRows] = useState<CatalogModel[]>([]);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/models?provider=${encodeURIComponent(provider)}`, { cache: "no-store", signal: ctrl.signal })
      .then((response) => response.ok ? response.json() : { models: [] })
      .then((body) => setRows((body.models ?? []) as CatalogModel[]))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [provider]);

  const options = useMemo(() => rows.some((row) => row.id === model) ? rows : [{ id: model, name: model }, ...rows], [model, rows]);

  async function select(next: string) {
    if (!next || next === model || saving) return;
    setSaving(true);
    setTest(null);
    try {
      const response = await fetch("/api/config", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model: next }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
      <div className="flex items-center gap-2">
        <Select value={model} onValueChange={select} disabled={saving}>
          <SelectTrigger className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="start">
            {options.slice(0, 80).map((row) => <SelectItem key={row.id} value={row.id}>{row.name || row.id}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={testSelected} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Test"}
        </Button>
      </div>
      {test ? <p className={`flex items-center gap-1 text-[10px] ${test.ok ? "text-success" : "text-destructive"}`}>{test.ok ? <CheckCircle2 className="size-3" /> : <TriangleAlert className="size-3" />}{test.text}</p> : null}
      <p className="text-[10px] text-muted-foreground">Switches only the model for the already-configured provider. Credentials and providers stay in Settings.</p>
    </div>
  );
}

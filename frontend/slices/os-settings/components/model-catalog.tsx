"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";
import { filterAndSortModels, type CatModel, type ModelFilters, type ModelSort } from "./model-catalog-utils";

const fmtCtx = (n?: number) => (!n ? "—" : n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`);
const fmtCost = (n?: number) => (n == null ? "—" : `$${n}`);

// Searchable model browser over the models.dev catalog for the selected provider,
// showing context window · $/M input+output · tool/reasoning/vision support. Pick →
// sets the model id in the parent. Empty for custom/OAuth providers (not in the catalog).
export function ModelCatalog({ provider, value, onPick }: { provider: string; value: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [models, setModels] = useState<CatModel[]>([]);
  const [sort, setSort] = useState<ModelSort>("best");
  const [filters, setFilters] = useState<ModelFilters>({ tools: false, reasoning: false, vision: false, minContext: 0 });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/models?provider=${encodeURIComponent(provider)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => alive && setModels((d.models ?? []) as CatModel[]))
      .catch(() => alive && setModels([]));
    return () => {
      alive = false;
    };
  }, [open, provider]);

  const filtered = useMemo(() => filterAndSortModels(models, q, filters, sort), [models, q, filters, sort]);
  const toggle = (key: "tools" | "reasoning" | "vision") => setFilters((f) => ({ ...f, [key]: !f[key] }));

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="[@media(pointer:coarse)]:min-h-[44px]">Browse</Button>
      <FormDrawer open={open} onOpenChange={setOpen} size="md">
        <FormDrawer.Header>
          <FormDrawer.Title>Models — {provider}</FormDrawer.Title>
        </FormDrawer.Header>
        <FormDrawer.Body className="space-y-3">
          <Input autoFocus placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select className="h-8 rounded-md border border-border bg-background px-2" value={sort} onChange={(e) => setSort(e.target.value as ModelSort)} aria-label="Sort models">
              <option value="best">Sort: most worth</option>
              <option value="price">Sort: lowest price</option>
              <option value="capability">Sort: capability</option>
              <option value="context">Sort: context length</option>
            </select>
            <select className="h-8 rounded-md border border-border bg-background px-2" value={filters.minContext} onChange={(e) => setFilters((f) => ({ ...f, minContext: Number(e.target.value) }))} aria-label="Minimum context length">
              <option value={0}>Any context</option>
              <option value={32000}>32K+ context</option>
              <option value={128000}>128K+ context</option>
              <option value={1000000}>1M+ context</option>
            </select>
            <Filter checked={filters.tools} label="Tools" onChange={() => toggle("tools")} />
            <Filter checked={filters.reasoning} label="Reasoning" onChange={() => toggle("reasoning")} />
            <Filter checked={filters.vision} label="Vision" onChange={() => toggle("vision")} />
          </div>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No catalog for this provider.</p>
          ) : (
            <div className="space-y-1 pr-3">
              {filtered.map((m) => (
                <button
                  key={m.ref}
                  type="button"
                  onClick={() => {
                    onPick(m.id);
                    setOpen(false);
                  }}
                  className={`flex w-full flex-col items-start gap-1 rounded-lg border p-2.5 text-left hover:bg-[var(--hover-strong)] ${m.id === value ? "border-primary" : "border-border"}`}
                >
                  <div className="flex w-full flex-wrap items-center gap-2">
                    <span className="font-medium">{m.name || m.id}</span>
                    {m.tools && <Badge>tools</Badge>}
                    {m.reasoning && <Badge>reasoning</Badge>}
                    {m.vision && <Badge>vision</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="font-mono">{m.id}</span>
                    <span>ctx {fmtCtx(m.context)}</span>
                    <span>in {fmtCost(m.inputCost)}/M</span>
                    <span>out {fmtCost(m.outputCost)}/M</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </FormDrawer.Body>
      </FormDrawer>
    </>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{children}</span>;
}

function Filter({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

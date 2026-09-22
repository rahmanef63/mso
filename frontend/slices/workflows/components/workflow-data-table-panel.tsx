"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  createDataTable,
  deleteDataTable,
  deleteDataTableRow,
  getDataTable,
  listDataTables,
  upsertDataTableRow,
  type WorkflowDataTable,
  type WorkflowDataTableSummary,
} from "../lib/api";

export function WorkflowDataTablePanel() {
  const [tables, setTables] = useState<WorkflowDataTableSummary[]>([]);
  const [table, setTable] = useState<WorkflowDataTable | null>(null);
  const [name, setName] = useState("");
  const [columns, setColumns] = useState("");
  const [rowId, setRowId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async (selectId?: string) => {
    setError("");
    const next = await listDataTables();
    setTables(next);
    const id = selectId ?? table?.id ?? next[0]?.id;
    setTable(id ? await getDataTable(id) : null);
  };
  useEffect(() => {
    let alive = true;
    void listDataTables().then(async (next) => {
      if (!alive) return;
      setTables(next);
      if (next[0]) setTable(await getDataTable(next[0].id));
    }).catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : "Data tables unavailable"); });
    return () => { alive = false; };
  }, []);

  const rowDraft = useMemo(() => Object.fromEntries((table?.columns ?? []).map((column) => [column, values[column] ?? ""])), [table?.columns, values]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Data-table action failed"); }
    finally { setBusy(false); }
  };
  const create = () => void act(async () => {
    const nextColumns = columns.split(",").map((value) => value.trim()).filter(Boolean);
    const created = await createDataTable(name, nextColumns);
    setName(""); setColumns(""); await load(created.id);
  });
  const saveRow = () => table && void act(async () => {
    await upsertDataTableRow(table.id, rowDraft, rowId || undefined);
    setRowId(""); setValues({}); await load(table.id);
  });
  const editRow = (id: string, row: Record<string, unknown>) => {
    setRowId(id);
    setValues(Object.fromEntries((table?.columns ?? []).map((column) => [column, row[column] == null ? "" : typeof row[column] === "string" ? row[column] as string : JSON.stringify(row[column])])));
  };

  return <div className="flex h-full min-h-0 flex-col">
    <div className="space-y-2 border-b p-3">
      <div className="flex items-center justify-between gap-2"><div><div className="text-xs font-semibold">Data tables</div><div className="text-[10px] text-muted-foreground">Owner-private persistent workflow data. Credentials stay in Integrations.</div></div><Button size="icon" variant="ghost" className="size-7" disabled={busy} onClick={() => void act(() => load())} aria-label="Refresh data tables"><RefreshCw className="size-3.5"/></Button></div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
        <Input className="h-8 text-xs" placeholder="Table name" value={name} onChange={(event) => setName(event.target.value)}/>
        <Input className="h-8 text-xs" placeholder="columns, comma, separated" value={columns} onChange={(event) => setColumns(event.target.value)}/>
        <Button size="icon" className="size-8" disabled={busy || !name.trim() || !columns.trim()} onClick={create} aria-label="Create data table"><Plus className="size-3.5"/></Button>
      </div>
      {tables.length ? <select aria-label="Workflow data table" className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={table?.id ?? ""} onChange={(event) => void act(async () => setTable(await getDataTable(event.target.value)))}>
        {tables.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.rowCount} rows</option>)}
      </select> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>

    {table ? <>
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2"><Database className="size-3.5 text-muted-foreground"/><span className="min-w-0 flex-1 truncate text-xs font-semibold">{table.name}</span><span className="text-[10px] text-muted-foreground">{table.rows.length} rows · {table.columns.length} cols</span><Button size="icon" variant="ghost" className="size-7 text-muted-foreground" disabled={busy} onClick={() => void act(async () => { await deleteDataTable(table.id); setTable(null); await load(); })} aria-label="Delete data table"><Trash2 className="size-3.5"/></Button></div>
        <div className="grid gap-1.5">{table.columns.map((column) => <label key={column} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 text-[10px] text-muted-foreground"><span className="truncate">{column}</span><Input className="h-7 text-xs" value={values[column] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [column]: event.target.value }))}/></label>)}</div>
        <div className="flex gap-1.5"><Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={saveRow}><Save className="mr-1 size-3"/>{rowId ? "Update row" : "Add row"}</Button>{rowId ? <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => { setRowId(""); setValues({}); }}>Cancel edit</Button> : null}</div>
      </div>
      <ScrollArea className="min-h-0 flex-1"><div className="space-y-1.5 p-2">
        {table.rows.length === 0 ? <p className="p-3 text-xs text-muted-foreground">No rows yet.</p> : null}
        {table.rows.map((row) => <div key={row.id} className="rounded-lg border bg-card p-2">
          <button type="button" className="w-full text-left" onClick={() => editRow(row.id, row.values)}>
            <div className="grid gap-1">{table.columns.map((column) => <div key={column} className="grid grid-cols-[78px_minmax(0,1fr)] gap-2 text-[10px]"><span className="truncate text-muted-foreground">{column}</span><span className="truncate">{formatCell(row.values[column])}</span></div>)}</div>
          </button>
          <div className="mt-1.5 flex justify-end"><Button size="icon" variant="ghost" className="size-6 text-muted-foreground" disabled={busy} onClick={() => void act(async () => { await deleteDataTableRow(table.id, row.id); await load(table.id); })} aria-label="Delete data-table row"><Trash2 className="size-3"/></Button></div>
        </div>)}
      </div></ScrollArea>
    </> : <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-xs text-muted-foreground">Create a data table for persistent workflow rows.</div>}
  </div>;
}

function formatCell(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

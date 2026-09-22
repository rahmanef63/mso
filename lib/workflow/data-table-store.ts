import { randomUUID } from "node:crypto";
import path from "node:path";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { workflowGraphOwner } from "./graph-store";
import { readWorkflowJson, writeWorkflowFile } from "./private-file";

export type WorkflowDataTableRow = { id: string; values: Record<string, unknown>; createdAt: string; updatedAt: string };
export type WorkflowDataTable = { id: string; name: string; columns: string[]; rows: WorkflowDataTableRow[]; createdAt: string; updatedAt: string };
type Store = { version: 1; owner: string; tables: Record<string, WorkflowDataTable> };

const MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_TABLES = 64;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 32;
const MAX_ROW_BYTES = 32 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;

function file(owner: string) {
  if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error("invalid workflow data-table owner");
  return path.join(agentSessionsDir(), ".workflow-data-tables", owner, "tables.json");
}
async function read(owner: string): Promise<Store> {
  try {
    const row = await readWorkflowJson(file(owner), MAX_STORE_BYTES, "workflow data-table store") as Store;
    if (row.version !== 1 || row.owner !== owner || !row.tables || typeof row.tables !== "object") throw new Error("invalid workflow data-table store");
    return row;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, owner, tables: {} };
    throw error;
  }
}
async function write(store: Store) {
  const body = JSON.stringify(store);
  if (Buffer.byteLength(body) > MAX_STORE_BYTES) throw new Error("workflow data-table store exceeds 8 MiB");
  await writeWorkflowFile(file(store.owner), body);
}
function tableName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 80) throw new Error("data-table name must be 1-80 characters");
  return name;
}
function columns(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_COLUMNS) throw new Error("data-table requires 1-32 columns");
  const result = [...new Set(value.map((item) => typeof item === "string" ? item.trim() : ""))];
  if (result.length !== value.length || result.some((item) => !item || item.length > 64 || !/^[A-Za-z][A-Za-z0-9_. -]{0,63}$/.test(item))) throw new Error("data-table columns must be unique simple names");
  return result;
}
function rowValues(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("data-table row values must be an object");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !allowed.includes(key))) throw new Error("data-table row contains an unknown column");
  const encoded = JSON.stringify(row);
  if (!encoded || Buffer.byteLength(encoded) > MAX_ROW_BYTES) throw new Error("data-table row exceeds 32 KiB");
  return structuredClone(row);
}
function tableId(value: unknown) {
  const id = typeof value === "string" ? value : "";
  if (!ID.test(id)) throw new Error("invalid data-table id");
  return id;
}

export async function listWorkflowDataTables(principal: string) {
  const owner = workflowGraphOwner(principal), store = await read(owner);
  return Object.values(store.tables).sort((a, b) => a.name.localeCompare(b.name)).map(({ rows, ...table }) => ({ ...table, rowCount: rows.length }));
}
export async function getWorkflowDataTable(principal: string, rawId: unknown) {
  const owner = workflowGraphOwner(principal), id = tableId(rawId), table = (await read(owner)).tables[id];
  if (!table) throw new Error("workflow data-table not found");
  return structuredClone(table);
}
export async function createWorkflowDataTable(principal: string, rawName: unknown, rawColumns: unknown) {
  const owner = workflowGraphOwner(principal), name = tableName(rawName), nextColumns = columns(rawColumns);
  return withSecurityStoreLock(file(owner), async () => {
    const store = await read(owner);
    if (Object.keys(store.tables).length >= MAX_TABLES) throw new Error("workflow data-table limit reached");
    const now = new Date().toISOString(), id = randomUUID();
    const table: WorkflowDataTable = { id, name, columns: nextColumns, rows: [], createdAt: now, updatedAt: now };
    store.tables[id] = table; await write(store); return structuredClone(table);
  });
}
export async function deleteWorkflowDataTable(principal: string, rawId: unknown) {
  const owner = workflowGraphOwner(principal), id = tableId(rawId);
  return withSecurityStoreLock(file(owner), async () => {
    const store = await read(owner), deleted = delete store.tables[id];
    if (deleted) await write(store);
    return { id, deleted };
  });
}
export async function upsertWorkflowDataTableRow(principal: string, rawTableId: unknown, rawRowId: unknown, rawValues: unknown) {
  const owner = workflowGraphOwner(principal), tableIdValue = tableId(rawTableId);
  return withSecurityStoreLock(file(owner), async () => {
    const store = await read(owner), table = store.tables[tableIdValue];
    if (!table) throw new Error("workflow data-table not found");
    const values = rowValues(rawValues, table.columns), rowId = rawRowId ? tableId(rawRowId) : randomUUID();
    const index = table.rows.findIndex((row) => row.id === rowId), now = new Date().toISOString();
    if (index < 0 && table.rows.length >= MAX_ROWS) throw new Error("workflow data-table row limit reached");
    const row: WorkflowDataTableRow = index >= 0 ? { ...table.rows[index]!, values, updatedAt: now } : { id: rowId, values, createdAt: now, updatedAt: now };
    if (index >= 0) table.rows[index] = row; else table.rows.push(row);
    table.updatedAt = now; await write(store); return structuredClone(row);
  });
}
export async function deleteWorkflowDataTableRow(principal: string, rawTableId: unknown, rawRowId: unknown) {
  const owner = workflowGraphOwner(principal), tableIdValue = tableId(rawTableId), rowId = tableId(rawRowId);
  return withSecurityStoreLock(file(owner), async () => {
    const store = await read(owner), table = store.tables[tableIdValue];
    if (!table) throw new Error("workflow data-table not found");
    const before = table.rows.length; table.rows = table.rows.filter((row) => row.id !== rowId);
    const deleted = table.rows.length !== before;
    if (deleted) { table.updatedAt = new Date().toISOString(); await write(store); }
    return { tableId: tableIdValue, rowId, deleted };
  });
}

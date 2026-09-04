"use client";

import { useSyncExternalStore } from "react";
import type { McpActivityRow } from "../components/mcp-activity-model";

const MAX_ROWS = 120;
let rows: McpActivityRow[] = [];
let currentRun: { id: string; intent: string } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());
const subscribe = (fn: () => void) => { subs.add(fn); return () => subs.delete(fn); };
const getRows = () => rows;
const EMPTY: McpActivityRow[] = [];

function upsert(row: McpActivityRow) {
  const i = rows.findIndex((item) => item.id === row.id);
  rows = i >= 0 ? rows.map((item, index) => index === i ? row : item) : [row, ...rows].slice(0, MAX_ROWS);
  emit();
}

export function useAlfaActivity(): McpActivityRow[] {
  return useSyncExternalStore(subscribe, getRows, () => EMPTY);
}

export function beginAlfaRun(intent: string): string {
  const id = `alfa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  currentRun = { id, intent: intent.replace(/\s+/g, " ").trim().slice(0, 120) || "Alfa task" };
  upsert({
    id: `${id}:run`, ts: new Date().toISOString(), actor: "alfa", tool: "alfa.chat",
    state: "started", workflowId: id, workflowIntent: currentRun.intent, workflowProject: undefined,
  });
  return id;
}

export function finishAlfaRun(id: string, outcome: "completed" | "failed" | "cancelled") {
  const row = rows.find((item) => item.id === `${id}:run`);
  if (row) upsert({ ...row, state: outcome, ts: new Date().toISOString() });
  if (currentRun?.id === id) currentRun = null;
}

export function recordAlfaTool(id: string, tool: string, state: McpActivityRow["state"], detail?: string, durationMs?: number) {
  const run = currentRun;
  const key = `${run?.id ?? "alfa-standalone"}:${id}`;
  const prior = rows.find((item) => item.id === key);
  upsert({
    id: key,
    ts: new Date().toISOString(),
    actor: "alfa",
    tool,
    state,
    scope: undefined,
    workflowId: run?.id,
    workflowIntent: run?.intent ?? "Alfa tool call",
    detail: detail?.slice(0, 220),
    durationMs,
    ...(prior?.target ? { target: prior.target } : {}),
  });
}

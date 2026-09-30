"use client";

import { useSyncExternalStore } from "react";

export type AlfaRunStatus = "working" | "waiting" | "done" | "failed" | "stopped";
export type AlfaRunActivity = { id: string; label: string; state: string; at: number };
export type AlfaRunState = {
  id: number;
  status: AlfaRunStatus;
  startedAt: number;
  finishedAt?: number;
  heartbeatAt: number;
  operation?: string;
  activities: AlfaRunActivity[];
};

let sequence = 0;
let state: AlfaRunState | null = null;
const subscribers = new Set<() => void>();
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => subscribers.delete(fn); };
const emit = () => subscribers.forEach((fn) => fn());
export const alfaRunState = () => state;
export function useAlfaRunState() {
  return useSyncExternalStore(subscribe, alfaRunState, () => null);
}

export function startAlfaRunState(): number {
  const now = Date.now();
  state = { id: ++sequence, status: "working", startedAt: now, heartbeatAt: now,
    operation: "Loading assistant", activities: [] };
  emit();
  return sequence;
}

export function setAlfaOperation(operation: string, waiting = false): void {
  if (!state || !["working", "waiting"].includes(state.status)) return;
  state = { ...state, status: waiting ? "waiting" : "working", operation, heartbeatAt: Date.now() };
  emit();
}

/** Heartbeats come from runner events, never from a UI animation or timer. */
export function pulseAlfaRun(): void {
  if (!state || state.status !== "working") return;
  state = { ...state, heartbeatAt: Date.now() };
  emit();
}

export function recordAlfaRunActivity(id: string, label: string, activityState: string): void {
  if (!state || !["working", "waiting"].includes(state.status)) return;
  const row = { id, label: label || state.activities.find((item) => item.id === id)?.label || id, state: activityState, at: Date.now() };
  state = { ...state, heartbeatAt: row.at,
    activities: [row, ...state.activities.filter((item) => item.id !== id)].slice(0, 120) };
  emit();
}

export function endAlfaRunState(id: number, status: "done" | "failed" | "stopped"): void {
  if (!state || state.id !== id || !["working", "waiting"].includes(state.status)) return;
  state = { ...state, status, operation: undefined, finishedAt: Date.now() };
  emit();
}

export function stopAlfaRunState(): void {
  if (state && ["working", "waiting"].includes(state.status)) endAlfaRunState(state.id, "stopped");
}

export function clearAlfaRunState(): void { state = null; emit(); }

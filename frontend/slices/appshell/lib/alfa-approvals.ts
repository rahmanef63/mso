"use client";

import { useSyncExternalStore } from "react";

// Where a parked mutate-tool call waits for the user.
//
// This map used to live inside the Assistant panel, which made an approval
// UNREACHABLE from anywhere else: on mobile only the focused app is rendered, so
// asking Alfa from the sheet to write a file parked the agent loop on a promise
// whose only resolver had been unmounted. The run hung forever behind a bare "…"
// with no Approve button anywhere on screen.
//
// It belongs beside the conversation store for the same reason the messages do:
// every surface shows the same run, so every surface must be able to answer it.
// POLICY stays in the assistant slice (which calls are rememberable, what counts
// as destructive) — this is only the rendezvous.

type Decision = { approve: boolean; remember: boolean };

const pending = new Map<string, (d: Decision) => void>();
const subscribers = new Set<() => void>();
let pendingCount = 0;

const emit = () => subscribers.forEach((fn) => fn());
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => subscribers.delete(fn); };
const getPendingCount = () => pendingCount;
const refreshCount = () => {
  const next = pending.size;
  if (next === pendingCount) return;
  pendingCount = next;
  emit();
};

export function useAlfaApprovalCount(): number {
  return useSyncExternalStore(subscribe, getPendingCount, () => 0);
}

/** Called by the tool binding; resolves when any surface answers the card. */
export function awaitAlfaApproval(id: string): Promise<Decision> {
  return new Promise<Decision>((resolve) => { pending.set(id, resolve); refreshCount(); });
}

/** Called by whichever surface rendered the card. */
export function resolveAlfaApproval(id: string, approve: boolean, remember: boolean): void {
  const r = pending.get(id);
  if (!r) return;
  pending.delete(id);
  refreshCount();
  r({ approve, remember });
}

/** Stop/unmount: unblock every parked call so the loop can unwind. */
export function clearAlfaApprovals(): void {
  pending.forEach((r) => r({ approve: false, remember: false }));
  pending.clear();
  refreshCount();
}

import type { AgentSessionEvent } from "./session-types";

/** Legacy ledgers start a new known sequence at zero; lost history is not guessed. */
export function eventSequenceBase(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Keep a suffix of the raw ledger and advance its persisted global offset exactly once. */
export function retainSessionEvents(events: AgentSessionEvent[], eventSeqBase: unknown, limit: number) {
  const dropped = Math.max(0, events.length - Math.max(0, Math.trunc(limit)));
  return { events: events.slice(dropped), eventSeqBase: eventSequenceBase(eventSeqBase) + dropped };
}

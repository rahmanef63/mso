import type { SliceBudgetEntry } from "./types";
import { absent, cite } from "./provenance";
import type { BudgetProfile } from "./profiles";

/**
 * Entry builders. Kept out of the registry data so that file is one row per slice
 * instead of helper code, and so every row can only be written through a constructor
 * that has to supply provenance.
 */

/** One cited call ceiling, so a row cannot carry a call number without its source. */
export type CallCeiling = { max: number; file: string; line: number; note: string };

/** What an absence claim says. Matched by registry.test.ts, which re-checks the tree. */
export const ABSENCE_NOTE = "no exec/PTY/subagent/worker-spawn call in this slice's tree";

/**
 * Absence of outbound traffic. Only used where the tree really has no `fetch` or
 * `/api/v1` reference; registry.test.ts re-checks that claim against disk.
 */
export const NO_CALL_NOTE = "no fetch or /api/v1 reference in this slice's tree";

/**
 * A profile plus one cited call ceiling. A non-worker slice also gets an absence claim
 * anchored to its own directory, which the registry test re-verifies against disk.
 */
export function limited(slice: string, profile: BudgetProfile, calls: CallCeiling, rationale: string): SliceBudgetEntry {
  const entry: SliceBudgetEntry = {
    slice,
    budget: { ...profile.budget, externalCallsPerMinute: calls.max },
    provenance: { ...profile.provenance, externalCallsPerMinute: cite(calls.file, calls.line, calls.note) },
    rationale,
  };
  if (entry.budget.maySpawnWorker === true) return entry;
  return { ...entry, provenance: { ...entry.provenance, maySpawnWorker: absent(slice, ABSENCE_NOTE) } };
}

/** A profile with no calls and an anchored worker-absence claim. */
export function idle(slice: string, profile: BudgetProfile, rationale: string): SliceBudgetEntry {
  return {
    slice,
    // A slice proven to make no call declares zero calls, cited to its own tree.
    // Declaring nothing would report `undeclared`, which reads as "unknown cost" for
    // a slice whose cost is genuinely zero.
    budget: { ...profile.budget, externalCallsPerMinute: 0 },
    provenance: {
      ...profile.provenance,
      externalCallsPerMinute: absent(slice, `${NO_CALL_NOTE}, so its call cost is zero`),
      maySpawnWorker: absent(slice, ABSENCE_NOTE),
    },
    rationale,
  };
}

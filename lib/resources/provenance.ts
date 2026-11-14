import type { Provenance } from "./types";

/**
 * Provenance helpers. Every declared number in the registry must go through one of
 * these, so the registry cannot grow a bare literal with no explanation.
 */

export {
  POLICY_CONCURRENT_TASKS,
  POLICY_CPU_MS_PER_MINUTE,
  POLICY_MEMORY_MIB,
} from "./policy";

/** A ceiling that already exists in this repository at `file:line`. */
export const cite = (file: string, line: number, note: string): Provenance => ({
  kind: "cited",
  file,
  line,
  note,
});

/** Arithmetic over cited constants; the note must name the inputs. */
export const derived = (file: string, line: number, note: string): Provenance => ({
  kind: "derived",
  file,
  line,
  note,
});

/** No ceiling exists in code yet. Reported as unknown, never as free. */
export const unmeasured = (note = "no cited ceiling exists in code"): Provenance => ({
  kind: "unmeasured",
  file: "lib/resources/policy.ts",
  line: 0,
  note,
});

/**
 * An absence claim: a read of one slice directory found no reference to the thing
 * being claimed absent. `line` stays 0 because an absence has no line; the note names
 * what was searched, and registry.test.ts re-checks that the directory exists.
 */
export const absent = (slice: string, note: string): Provenance => ({
  kind: "derived",
  file: `frontend/slices/${slice}`,
  line: 0,
  note,
});

/** This module's own declared policy. Cite the constant, not a guess. */
export const policyAt = (line: number, note: string): Provenance => ({
  kind: "policy",
  file: "lib/resources/policy.ts",
  line,
  note,
});

/**
 * Enforcement policy. OFF BY DEFAULT, and that is a deliberate product decision.
 *
 * A budget that silently kills a slice's work is worse than a budget nobody
 * enforces: the failure arrives as "the feature stopped working" with no operator
 * action, no audit line, and a number nobody has validated against real traffic.
 * So this module reports first and only refuses when an operator explicitly opts in.
 *
 * Enabled via `OS_SLICE_RESOURCE_ENFORCEMENT=1`. Any other value — including an
 * unreadable or malformed one — leaves enforcement off.
 */
export const ENFORCEMENT_ENV = "OS_SLICE_RESOURCE_ENFORCEMENT";

/**
 * True only for the literal `1`.
 *
 * Deliberately not `Boolean(value)`: "false", "0" and "no" are all truthy strings,
 * and an operator writing `OS_SLICE_RESOURCE_ENFORCEMENT=false` must get reporting
 * rather than accidental refusal.
 */
export function sliceResourceEnforcementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENFORCEMENT_ENV] === "1";
}

/**
 * What enforcement would do when enabled: refuse a call whose slice is already at or
 * over its declared concurrent-task ceiling.
 *
 * This is the one refusal that is admissible, because the ceiling it compares
 * against already exists in code (4 concurrent bounded tasks, cited below). CPU and
 * call-rate refusals are NOT implemented: the ledger's CPU figure is process-scoped,
 * so it is not evidence for refusing one slice's call.
 */
export const ENFORCEMENT_SCOPE = "concurrent-tasks only";

/**
 * POLICY, not a measurement. MSO has no per-slice CPU-time ceiling anywhere in code
 * today (checked: lib/host/exec.ts bounds a single command, nothing bounds a slice),
 * so the only honest declared value is this explicit policy: one slice may consume
 * at most one core-minute of CPU per wall-clock minute.
 *
 * Why one core: MSO is a single Node process on a shared host, and a slice that
 * needs more than a full core continuously is a design problem worth seeing in the
 * report rather than a number worth guessing. Raising it is a policy change, not a
 * measurement change.
 */
export const POLICY_CPU_MS_PER_MINUTE = 60_000;

/**
 * POLICY, not a measurement. Default concurrent task slots for a slice that has no
 * cited concurrency constant of its own. It mirrors the per-actor concurrency this
 * repository already enforces for bounded runners:
 * lib/host/exec-jobs.ts:12 MAX_ACTIVE_PER_ACTOR = 4 and
 * lib/agent/subagent-jobs.ts:6 MAX_CONCURRENT_PER_PRINCIPAL = 4.
 */
export const POLICY_CONCURRENT_TASKS = 4;

/**
 * POLICY, not a measurement. Default memory envelope for a server-side slice with no
 * cited byte cap of its own, taken from the largest buffer this repository already
 * allows a single host operation to hold (lib/host/fs-grep.ts:10, 64 MiB total scan).
 * A slice measured above this is holding more than any one host read is allowed to.
 */
export const POLICY_MEMORY_MIB = 64;

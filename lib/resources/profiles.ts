import type { SliceBudget, SliceBudgetProvenance } from "./types";
import { POLICY_CONCURRENT_TASKS, POLICY_CPU_MS_PER_MINUTE, POLICY_MEMORY_MIB, cite, derived, policyAt, unmeasured } from "./provenance";

/**
 * Budget profiles.
 *
 * A profile exists so one cited number is not retyped 32 times and silently drift.
 * Every field carries its own provenance, and a field with no cited ceiling says
 * `null` + `unmeasured` rather than inventing a value.
 *
 * Units: cpuMsPerMinute is CPU milliseconds per wall-clock minute; memoryMiB is
 * MiB; externalCallsPerMinute is calls per rolling minute.
 */
export type BudgetProfile = {
  budget: SliceBudget;
  provenance: SliceBudgetProvenance;
};

/**
 * Base profile. CPU, memory and slot ceilings are explicit MSO policy because no
 * per-slice constant exists in code; the call ceiling is deliberately unknown here
 * so that every slice which does make calls must cite its own real limiter.
 */
export const STATIC: BudgetProfile = {
  budget: {
    cpuMsPerMinute: POLICY_CPU_MS_PER_MINUTE,
    memoryMiB: POLICY_MEMORY_MIB,
    concurrentTasks: POLICY_CONCURRENT_TASKS,
    externalCallsPerMinute: null,
    maySpawnWorker: false,
  },
  provenance: {
    cpuMsPerMinute: policyAt(47, "POLICY_CPU_MS_PER_MINUTE: one core-minute per wall-clock minute"),
    memoryMiB: policyAt(64, "POLICY_MEMORY_MIB: matches the largest single host-read budget"),
    concurrentTasks: policyAt(56, "POLICY_CONCURRENT_TASKS: mirrors the existing per-actor cap of 4"),
    externalCallsPerMinute: unmeasured("this profile makes no outbound call, so it declares no call ceiling"),
    maySpawnWorker: derived("lib/host/exec-jobs.ts", 12, "no worker-spawning capability is referenced from this slice directory"),
  },
};

/** Worker-capable slice: the worst case of the existing per-actor cap and timeout. */
export const WORKER: BudgetProfile = withWorker(STATIC, "lib/host/exec.ts", 16);

/** Mark a profile worker-capable, preserving its other cited fields. */
export function withWorker(profile: BudgetProfile, file: string, line: number): BudgetProfile {
  return {
    budget: { ...profile.budget, cpuMsPerMinute: 4 * 30_000, maySpawnWorker: true },
    provenance: {
      ...profile.provenance,
      cpuMsPerMinute: derived("lib/host/exec.ts", 16, "TIMEOUT_MS 30_000 x lib/host/exec-jobs.ts:12 MAX_ACTIVE_PER_ACTOR 4 = 120000 CPU ms per minute"),
      maySpawnWorker: cite(file, line, "this slice reaches a worker-spawning capability"),
    },
  };
}

/** A UI slice whose only recurring traffic is a poll at the cited interval. */
export const poll = (ms: number, file: string, line: number): BudgetProfile => ({
  budget: { ...STATIC.budget, externalCallsPerMinute: Math.round(60_000 / ms) },
  provenance: {
    ...STATIC.provenance,
    externalCallsPerMinute: derived(file, line, `${ms} ms poll interval: 60000/${ms} calls per wall-clock minute`),
  },
});

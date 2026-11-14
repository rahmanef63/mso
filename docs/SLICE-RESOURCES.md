# Slice resource accounting

> Current reference. Describes what exists on `main`; `docs/PROGRESS.md` records why.

MSO has 32 feature slices under `frontend/slices/`. Before this surface, the only cost
signals were whole-host: `lib/capabilities/result-budget.ts` bounds one tool result,
`lib/capabilities/rate-limit.ts` bounds request counts, `lib/capabilities/scope-policy.ts`
bounds authority, and the `system-monitor` slice reports host CPU/memory/disk. None of them
answered "what does this slice cost".

This module answers that per slice, and it reports rather than enforces.

## Where it lives

| Concern | Module |
|---|---|
| Registry (declared ceilings, each cited) | `lib/resources/registry-data.ts` |
| Shared budget profiles | `lib/resources/profiles.ts` |
| Explicitly declared policy constants | `lib/resources/policy.ts` |
| Cited / derived / unmeasured provenance helpers | `lib/resources/provenance.ts` |
| Ledger (measured usage) | `lib/resources/ledger.ts` |
| Capability to slice attribution | `lib/resources/attribution.ts` |
| Budget vs actual, evidence classes | `lib/resources/report.ts` |
| Authoritative slice list (read from disk) | `lib/resources/slices.ts` |
| Measurement point | `lib/capabilities/execute.ts` |
| Read surface | `GET /api/v1/sys/slice-resources`, `mso slice-resources` |
| Panel | `frontend/slices/system-monitor/components/slice-resources-panel.tsx` |

## Registry

Five fields per slice: CPU-time budget, memory budget, concurrent task slots, external API
calls per minute, and whether the slice may spawn a worker.

Every field carries a `Provenance` with one of four kinds:

- `cited`: a constant that already exists in this repository, with `file:line`.
- `derived`: arithmetic over cited constants, with the inputs named in the note.
- `policy`: an explicit decision declared in `lib/resources/policy.ts`. Not measured.
- `unmeasured`: no ceiling exists in code. Reported as unknown, never as zero.

`registry.test.ts` reads the real directory and fails when a slice exists on disk with no
entry, when an entry names a slice that does not exist, when a slice is registered twice, or
when a cited claim lacks a file and line.

## Ledger and its limits

`lib/capabilities/execute.ts` wraps every capability call and records wall time, process CPU
delta, in-flight concurrency for that slice, and result bytes. Three limits are stated in the
module rather than hidden:

- `cpuMs` is a `process.cpuUsage()` delta, so it is process-scoped. Under concurrency it
  includes work from other slices sharing the event loop, which makes it an upper bound.
- The buffer is in-memory and process-local: 2048 samples, oldest evicted, and it resets on
  restart.
- A call with no owning slice records as `slice: null` and is reported in the `unaccounted`
  block. It is never folded into a slice total.

## Evidence classes

Every reported field says which of these it is:

| Class | Meaning |
|---|---|
| `measured` | Read off the ledger. A real call happened. |
| `estimated` | Arithmetic over measured values, projected to a per-minute window. |
| `under-sampled` | Too little elapsed time exists to state a rate honestly. |
| `declared-only` | The registry states it and nothing measures it yet. |
| `undeclared` | The registry says no ceiling is known. |
| `not-instrumented` | The value exists conceptually but MSO does not measure it. |

`under-sampled` exists because of a real failure mode: one capability call 5 ms ago,
projected to a per-minute rate, reads as hundreds of thousands of CPU milliseconds and
renders as "over budget" for a slice that has done nothing wrong. `perMinute()` returns
null below a 10 s window, and the field says `under-sampled` rather than reporting a spike.

Memory is `not-instrumented` today because nothing measures per-slice resident memory.
Reporting result bytes there would be a different measurement wearing that field's name.

## Unaccounted slices

A slice directory with no registry entry is listed in `unaccountedSlices` and marked
`accounted: false`. It is never assumed free. Adding a slice therefore requires exactly one
registry entry.

## Enforcement

Off by default. Reporting is always on.

Any refusal is gated behind `OS_SLICE_RESOURCE_ENFORCEMENT=1`, and only the literal `1`
enables it, because `"false"` and `"0"` are truthy strings. The only refusal scoped today is
the concurrent-task ceiling, since that ceiling already exists in code
(`lib/host/exec-jobs.ts:12`). CPU and call-rate refusals are deliberately not implemented: the
ledger's CPU figure is process-scoped and therefore not admissible evidence for refusing one
slice's call.

## Scope

The report is installation-wide. MSO has no per-organization or per-tenant resource ledger:
tenancy is a source-only preview seam (`OS_TENANCY_MODE`) and the capability ledger is
process-global. The route returns that fact in its `scope` block rather than implying
isolation it cannot provide.

Honest coverage: 32 of 32 slices are registered, but measurement is partial. Nine slices
have at least one attributed capability tool; four more are documented by an owning route
that the kernel does not instrument; the rest report declared budgets with
`not-instrumented` actuals. The route returns those three counts separately as `coverage`
so the report states its own limit instead of totalling them into one number.

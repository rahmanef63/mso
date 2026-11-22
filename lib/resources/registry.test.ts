import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { knownSliceDirectories } from "./slices";
import { REGISTRY } from "./registry-data";
import { STATIC, WORKER, withWorker } from "./profiles";
import { POLICY_CONCURRENT_TASKS } from "./policy";
import { ATTRIBUTION } from "./attribution";

/**
 * Registry completeness against the REAL slice list.
 *
 * The directory read is the only source of truth here: the test never carries its own
 * hard-coded copy of the 32 names, because a second copy is a copy that goes stale.
 * Adding a slice directory without a budget entry fails this test, which is the whole
 * acceptance criterion for the registry.
 */
/** Every non-test source file inside one slice directory. */
function sliceSources(slice: string): string[] {
  const root = join(process.cwd(), "frontend", "slices", slice);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(full);
    }
  };
  try { walk(root); } catch { return []; }
  return out;
}

/** Files in one slice that reference a source pattern. Empty means "none found". */
function matchingSources(slice: string, pattern: RegExp): string[] {
  return sliceSources(slice).filter((file) => pattern.test(readFileSync(file, "utf8")));
}

/**
 * Worker-spawning CALLS inside one slice directory. This is what keeps a
 * `maySpawnWorker: false` claim honest: if a slice later starts an exec job, PTY,
 * subagent or host command, this list stops being empty and the test fails.
 *
 * Matched on call shapes, not bare tool names: `exec_run` also appears in Settings
 * help copy ("your agent will see exec_run"), which is documentation rather than a
 * spawn.
 */
const WORKER_CALLS = /api\.exec\.run|exec_job_start|pty_session|startPty\(|\/api\/v1\/exec\/run|\/api\/v1\/term\/(open|input|stream)|agent_subagent_start|project_agent_run|child_process|spawn\(/;

/**
 * Any outbound traffic in one slice directory. A slice declaring a zero call budget
 * must have none: this check makes that claim falsifiable instead of aspirational.
 */
const OUTBOUND = /\bfetch\(|\/api\/v1\/|api\.(fs|exec|sys|apps|browser|projects)\.|new EventSource\(/;

describe("slice resource registry", () => {
  const onDisk = knownSliceDirectories();

  it("reads the real slice directory rather than a fixture", () => {
    expect(onDisk.length).toBeGreaterThan(20);
    expect(onDisk).toContain("system-monitor");
    expect(onDisk).toContain("appshell");
  });

  it("registers exactly one entry for every slice on disk", () => {
    const registered = REGISTRY.map((entry) => entry.slice);
    const missing = onDisk.filter((slice) => !registered.includes(slice));
    expect(missing, `unregistered slices: ${missing.join(", ")}`).toEqual([]);
  });

  it("fails the completeness check when a new directory appears unregistered", () => {
    // Proves the mechanism rather than today's state: a directory added without an
    // entry must be reported missing, which is what "fails when a new slice appears"
    // means. Uses a synthetic name so it never depends on the real tree.
    const synthetic = [...onDisk, "slice-added-by-a-test"];
    const registered = REGISTRY.map((entry) => entry.slice);
    expect(synthetic.filter((slice) => !registered.includes(slice))).toEqual(["slice-added-by-a-test"]);
    // And the real list is unaffected by that probe.
    expect(knownSliceDirectories()).not.toContain("slice-added-by-a-test");
  });

  it("has no entry for a slice that does not exist on disk", () => {
    const stale = REGISTRY.map((entry) => entry.slice).filter((slice) => !onDisk.includes(slice));
    expect(stale, `registry names a missing slice: ${stale.join(", ")}`).toEqual([]);
  });

  it("never registers one slice twice", () => {
    const registered = REGISTRY.map((entry) => entry.slice);
    expect(new Set(registered).size).toBe(registered.length);
  });

  it("cites every declared field, and calls an unknown ceiling unknown", () => {
    for (const entry of REGISTRY) {
      for (const [field, provenance] of Object.entries(entry.provenance)) {
        expect(provenance.note.length, `${entry.slice}.${field}`).toBeGreaterThan(10);
      // A cited/derived/policy claim must point at a real file and a real line, or at
      // a slice tree for an absence claim (which has neither a file nor a line).
      if (provenance.kind !== "unmeasured" && !provenance.file.startsWith("frontend/slices/")) {
        expect(provenance.file, `${entry.slice}.${field}`).toMatch(/\.(ts|tsx)$/);
        expect(provenance.line, `${entry.slice}.${field}`).toBeGreaterThan(0);
      }
      }
      // A field with no cited ceiling must be null, not a fabricated number.
      if (entry.provenance.externalCallsPerMinute.kind === "unmeasured")
        expect(entry.budget.externalCallsPerMinute).toBeNull();
    }
  });

  it("points every citation at a file and line that exist", () => {
    // A file:line citation that no longer exists is worse than no citation: it looks
    // verified. This reads the cited file and checks the line is inside it.
    for (const entry of REGISTRY) {
      for (const [field, provenance] of Object.entries(entry.provenance)) {
        if (provenance.line === 0) continue; // absence claims have no line
        const file = join(process.cwd(), provenance.file);
        expect(existsSync(file), `${entry.slice}.${field} cites a missing file ${provenance.file}`).toBe(true);
        const lines = readFileSync(file, "utf8").split("\n").length;
        expect(provenance.line, `${entry.slice}.${field} cites ${provenance.file}:${provenance.line} past EOF`)
          .toBeLessThanOrEqual(lines);
      }
    }
  });

  it("carries a rationale for every entry", () => {
    for (const entry of REGISTRY) expect(entry.rationale.length, entry.slice).toBeGreaterThan(20);
  });

  it("keeps the worker flag aligned with the profile that set it", () => {
    for (const entry of REGISTRY) {
      const declared = entry.budget.maySpawnWorker;
      const provenance = entry.provenance.maySpawnWorker;
      if (declared === true) {
        expect(provenance.kind, `${entry.slice} claims a worker with no citation`).toBe("cited");
        expect(provenance.file).toMatch(/\.(ts|tsx)$/);
      } else {
        // An absence claim must be anchored to the slice's own tree, so a later
        // worker-spawning capability added to that slice contradicts a checkable file.
        expect(provenance.file, entry.slice).toBe(`frontend/slices/${entry.slice}`);
        expect(matchingSources(entry.slice, WORKER_CALLS), `${entry.slice} now references a worker`).toEqual([]);
      }
    }
  });

  it("only claims a zero call budget for a slice with no outbound traffic", () => {
    for (const entry of REGISTRY) {
      if (entry.budget.externalCallsPerMinute !== 0) continue;
      expect(entry.provenance.externalCallsPerMinute.kind, entry.slice).toBe("derived");
      expect(entry.provenance.externalCallsPerMinute.file, entry.slice).toBe(`frontend/slices/${entry.slice}`);
      expect(matchingSources(entry.slice, OUTBOUND), `${entry.slice} now makes a call`).toEqual([]);
    }
  });

  it("only assigns a call ceiling from a limiter that is actually a call rate", () => {
    // Guards the unit mistake this registry made once: a file count, a page size and a
    // concurrent-stream limit were each reported as "calls per minute". A cited call
    // ceiling must come from a limiter whose note says per-minute/per-60s, or from a
    // poll interval converted by the profile.
    for (const entry of REGISTRY) {
      const field = entry.provenance.externalCallsPerMinute;
      if (entry.budget.externalCallsPerMinute === null || entry.budget.externalCallsPerMinute === 0) continue;
      if (field.kind === "derived") continue; // poll interval: 60000/ms, stated in the note
      expect(field.kind, entry.slice).toBe("cited");
      expect(field.note, `${entry.slice} cites a bound that is not a call rate`).toMatch(/per (?:60 s|minute|min)|\/min/i);
    }
  });

  it("does not attribute tools to slices that exist", () => {
    for (const row of ATTRIBUTION) {
      expect(onDisk, `${row.tool} -> ${row.slice}`).toContain(row.slice);
      expect(row.evidence.line).toBeGreaterThan(0);
    }
  });

  it("does not attribute the same tool twice", () => {
    const tools = ATTRIBUTION.map((row) => row.tool);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it("exposes the shared profiles used by the registry", () => {
    expect(STATIC.budget.concurrentTasks).toBe(POLICY_CONCURRENT_TASKS);
    expect(WORKER.budget.maySpawnWorker).toBe(true);
    expect(WORKER.budget.cpuMsPerMinute).toBe(4 * 30_000);
    // withWorker keeps the base profile's call ceiling out of the worker shape, so a
    // worker slice must still cite its own limiter.
    expect(withWorker(STATIC, "lib/host/exec.ts", 16).budget.externalCallsPerMinute).toBeNull();
  });
});

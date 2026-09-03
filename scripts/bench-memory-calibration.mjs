#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function pct2(n, d) { return d ? Math.round((n / d) * 10_000) / 100 : 0; }
function bytes(value) { return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8"); }
function principalDir(root, principal) { return path.join(root, createHash("sha256").update(principal).digest("hex").slice(0, 32)); }
function semantic(result) {
  return result.records.map((row) => ({ value: row.record.value, authority: row.record.provenance.authority, confidence: row.record.confidence, conflicts: row.conflicts.map((r) => r.value).sort() }));
}

export async function runMemoryCalibration({ correctionDepth = 40 } = {}) {
  const depth = Math.max(8, Math.min(200, Math.trunc(correctionDepth) || 40));
  const root = await mkdtemp(path.join(os.tmpdir(), "mso-memory-p9-"));
  const previous = process.env.OS_AGENT_MEMORY_DIR;
  process.env.OS_AGENT_MEMORY_DIR = root;
  try {
    const store = await import("../lib/agent/memory-store.ts");
    const now = Date.now();
    const T = {
      old: new Date(now - 3 * 86_400_000).toISOString(),
      recent: new Date(now - 86_400_000).toISOString(),
      future: new Date(now + 86_400_000).toISOString(),
      later: new Date(now + 2 * 86_400_000).toISOString(),
    };
    const scenarios = [];

    {
      const principal = "p9:authority";
      await store.rememberAgentMemory(principal, "MEMORY.md", "Release region", "Singapore", { mode: "claim", confidence: 1, provenance: { authority: "observed", channel: "system", observedAt: T.recent } });
      await store.rememberAgentMemory(principal, "MEMORY.md", "Release region", "Jakarta", { mode: "claim", confidence: 0.4, provenance: { authority: "explicit", channel: "mcp", observedAt: T.old } });
      const a = await store.queryAgentMemory(principal, { query: "release region" }), b = await store.queryAgentMemory(principal, { query: "release region" });
      scenarios.push({ id: "explicit-authority", pass: a.records[0]?.record.value === "Jakarta" && a.records[0]?.conflicts.some((r) => r.value === "Singapore"), deterministic: JSON.stringify(semantic(a)) === JSON.stringify(semantic(b)) });
    }

    {
      const principal = "p9:confidence-recency";
      await store.rememberAgentMemory(principal, "MEMORY.md", "Runtime", "Bun", { mode: "claim", confidence: 0.9, provenance: { authority: "observed", channel: "system", observedAt: T.old } });
      await store.rememberAgentMemory(principal, "MEMORY.md", "Runtime", "Node", { mode: "claim", confidence: 0.6, provenance: { authority: "observed", channel: "system", observedAt: T.recent } });
      const confidence = await store.queryAgentMemory(principal, { query: "runtime" });
      await store.rememberAgentMemory(principal, "MEMORY.md", "Branch", "develop", { mode: "claim", confidence: 0.8, provenance: { authority: "observed", channel: "system", observedAt: T.old } });
      await store.rememberAgentMemory(principal, "MEMORY.md", "Branch", "main", { mode: "claim", confidence: 0.8, provenance: { authority: "observed", channel: "system", observedAt: T.recent } });
      const recency = await store.queryAgentMemory(principal, { query: "branch" });
      scenarios.push({ id: "confidence-then-recency", pass: confidence.records[0]?.record.value === "Bun" && recency.records[0]?.record.value === "main", deterministic: true });
    }

    {
      const principal = "p9:future-transition";
      await store.rememberAgentMemory(principal, "USER.md", "Office", "Jakarta", { validFrom: T.old });
      await store.rememberAgentMemory(principal, "USER.md", "Office", "Singapore", { validFrom: T.future });
      const before = await store.queryAgentMemory(principal, { query: "office", at: new Date(now).toISOString() });
      const after = await store.queryAgentMemory(principal, { query: "office", at: T.later });
      scenarios.push({ id: "future-replacement-boundary", pass: before.records[0]?.record.value === "Jakarta" && after.records[0]?.record.value === "Singapore", deterministic: true });
    }

    {
      const principal = "p9:forget-future";
      await store.rememberAgentMemory(principal, "USER.md", "Office", "Jakarta", { validFrom: T.old });
      await store.rememberAgentMemory(principal, "USER.md", "Office", "Singapore", { validFrom: T.future });
      await store.forgetAgentMemory(principal, "USER.md", "Office");
      const current = await store.queryAgentMemory(principal, { query: "office" });
      const future = await store.queryAgentMemory(principal, { query: "office", at: T.later });
      const history = await store.queryAgentMemory(principal, { query: "office", includeHistory: true, limit: 10 });
      scenarios.push({ id: "forget-no-future-resurrection", pass: current.records.length === 0 && future.records.length === 0 && history.records.length === 2 && history.records.every((row) => row.record.retractedAt), deterministic: true });
    }

    {
      const principal = "p9:forget-history";
      await store.rememberAgentMemory(principal, "MEMORY.md", "Region", "Jakarta", { validFrom: T.old });
      await store.rememberAgentMemory(principal, "MEMORY.md", "Region", "Singapore", { validFrom: T.recent });
      await store.forgetAgentMemory(principal, "MEMORY.md", "Region");
      const history = await store.queryAgentMemory(principal, { query: "region", includeHistory: true, limit: 10 });
      const jakarta = history.records.find((row) => row.record.value === "Jakarta")?.record;
      const singapore = history.records.find((row) => row.record.value === "Singapore")?.record;
      scenarios.push({
        id: "forget-preserves-finished-history",
        pass: Boolean(jakarta?.supersededAt) && !jakarta?.retractedAt && Boolean(singapore?.retractedAt),
        deterministic: true,
      });
    }

    let projection = null;
    {
      const principal = "p9:repeated-corrections";
      for (let i = 0; i < depth; i++) await store.rememberAgentMemory(principal, "MEMORY.md", "Preferred runtime", `Runtime-${i + 1}`);
      const resolved = await store.queryAgentMemory(principal, { query: "preferred runtime" });
      const history = await store.queryAgentMemory(principal, { query: "preferred runtime", includeHistory: true, limit: 100 });
      const snapshot = await store.readAgentMemory(principal);
      const ledgerRaw = await readFile(path.join(principalDir(root, principal), "records-v1.json"), "utf8");
      const ledger = JSON.parse(ledgerRaw);
      const ledgerBytes = bytes(ledgerRaw);
      const resolvedBytes = bytes({ user: snapshot.user, memory: snapshot.memory });
      projection = {
        correctionDepth: depth, ledgerRecords: ledger.records.length, historyRowsReturned: history.records.length, historyLimit: 100,
        resolvedRecords: resolved.records.length, finalValue: resolved.records[0]?.record.value ?? null, ledgerBytes,
        resolvedProjectionBytes: resolvedBytes, projectionReductionPct: pct2(ledgerBytes - resolvedBytes, ledgerBytes),
      };
      scenarios.push({
        id: "repeated-correction-projection",
        pass: ledger.records.length === depth && history.records.length === Math.min(depth, 100) && resolved.records.length === 1
          && resolved.records[0]?.record.value === `Runtime-${depth}` && resolvedBytes < ledgerBytes,
        deterministic: true,
      });
    }

    const passed = scenarios.filter((row) => row.pass && row.deterministic).length;
    return {
      calibrationVersion: "mso-memory-calibration-v1", scenarioCount: scenarios.length, passed,
      accuracyPct: pct(passed, scenarios.length), deterministic: scenarios.every((row) => row.deterministic),
      scenarios, projection,
      graphMemoryRequiredByCalibration: false,
      note: "Calibration uses an isolated temporary memory root. It checks keyed ledger semantics and resolved-context projection only; it does not mutate real user memory, grant authority, or infer a need for graph memory from synthetic complexity.",
    };
  } finally {
    if (previous === undefined) delete process.env.OS_AGENT_MEMORY_DIR; else process.env.OS_AGENT_MEMORY_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const i = process.argv.indexOf("--corrections"), correctionDepth = i >= 0 ? Number(process.argv[i + 1]) : 40;
  const result = await runMemoryCalibration({ correctionDepth });
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`MSO memory calibration · ${result.passed}/${result.scenarioCount} pass · deterministic=${result.deterministic}`);
    for (const row of result.scenarios) console.log(`  ${row.pass && row.deterministic ? "PASS" : "FAIL"} ${row.id}`);
    console.log(`  repeated corrections ${result.projection.correctionDepth} → ${result.projection.resolvedRecords} resolved record · projection ${result.projection.projectionReductionPct}% smaller than ledger`);
  }
  if (result.accuracyPct !== 100 || !result.deterministic) process.exitCode = 1;
}

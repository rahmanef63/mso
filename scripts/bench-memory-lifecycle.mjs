#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function principalDir(root, principal) { return path.join(root, createHash("sha256").update(principal).digest("hex").slice(0, 32)); }
function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }
function row(i, base, count) {
  const validFrom = new Date(base + i * 1000).toISOString();
  const next = i + 1 < count ? new Date(base + (i + 1) * 1000).toISOString() : undefined;
  return {
    id: `p10_mem_${String(i + 1).padStart(4, "0")}`,
    document: "MEMORY.md",
    key: "Preferred runtime",
    value: `Runtime-${i + 1}`,
    kind: "semantic",
    confidence: 1,
    sensitivity: "normal",
    validFrom,
    createdAt: validFrom,
    provenance: { authority: "explicit", channel: "system", observedAt: validFrom },
    ...(i ? { supersedes: [`p10_mem_${String(i).padStart(4, "0")}`] } : {}),
    ...(next ? { supersededAt: next, supersededBy: `p10_mem_${String(i + 2).padStart(4, "0")}` } : {}),
  };
}

export async function runMemoryLifecycleCalibration() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mso-memory-p10-"));
  const memoryRoot = path.join(root, "memory"), sessionRoot = path.join(root, "sessions"), sessionArchiveRoot = path.join(root, "session-archives");
  const previous = Object.fromEntries(["OS_AGENT_MEMORY_DIR", "OS_AGENT_SESSIONS_DIR", "OS_AGENT_SESSION_ARCHIVE_DIR"].map((key) => [key, process.env[key]]));
  process.env.OS_AGENT_MEMORY_DIR = memoryRoot;
  process.env.OS_AGENT_SESSIONS_DIR = sessionRoot;
  process.env.OS_AGENT_SESSION_ARCHIVE_DIR = sessionArchiveRoot;
  try {
    const store = await import("../lib/agent/memory-store.ts");
    const ledgerLib = await import("../lib/agent/memory-ledger.ts");
    const archiveLib = await import("../lib/agent/memory-archive.ts");
    const session = await import("../lib/agent/session-store.ts");
    const scenarios = [];

    const principal = "p10:lifecycle";
    const dir = principalDir(memoryRoot, principal);
    const count = 1400;
    const base = Date.now() - (count + 20) * 1000;
    const seed = { schemaVersion: 1, updatedAt: new Date(base + (count - 1) * 1000).toISOString(), records: Array.from({ length: count }, (_, i) => row(i, base, count)) };
    await ledgerLib.writeMemoryLedger(dir, seed);
    await store.rememberAgentMemory(principal, "MEMORY.md", "Preferred runtime", "P10-Final");

    const liveRaw = JSON.parse(await readFile(path.join(dir, "records-v1.json"), "utf8"));
    const archived = await archiveLib.readMemoryArchive(dir);
    const current = await store.queryAgentMemory(principal, { query: "preferred runtime" });
    scenarios.push({
      id: "retention-before-hard-cap",
      pass: liveRaw.records.length <= 1000 && archived.records.length >= 400 && current.records.length === 1 && current.records[0]?.record.value === "P10-Final",
      evidence: { liveRecords: liveRaw.records.length, archivedRecords: archived.records.length },
    });

    const oldHistory = await store.queryAgentMemory(principal, { query: "Runtime-1", includeHistory: true, limit: 10 });
    scenarios.push({ id: "explicit-archived-history", pass: oldHistory.records.some((item) => item.record.value === "Runtime-1"), evidence: { returned: oldHistory.records.length } });

    const historicalAt = new Date(base + 250).toISOString();
    const historical = await store.queryAgentMemory(principal, { query: "preferred runtime", at: historicalAt });
    scenarios.push({ id: "archived-temporal-resolution", pass: historical.records[0]?.record.value === "Runtime-1", evidence: { value: historical.records[0]?.record.value ?? null } });

    const telemetry = await store.agentMemoryTelemetry(principal);
    const telemetryText = JSON.stringify(telemetry);
    scenarios.push({
      id: "privacy-safe-aggregate-telemetry",
      pass: telemetry.liveRecords === liveRaw.records.length && telemetry.archivedRecords === archived.records.length && telemetry.totalStructuredRecords === count + 1 && telemetry.maxCorrectionsPerKey === count
        && !telemetryText.includes("Preferred runtime") && !telemetryText.includes("P10-Final") && !telemetryText.includes(principal),
      evidence: telemetry,
    });

    const archiveDirStat = await stat(path.join(dir, "archive-v1"));
    const [segmentName] = (await readdir(path.join(dir, "archive-v1"))).filter((name) => name.endsWith(".json"));
    const archiveFileStat = await stat(path.join(dir, "archive-v1", segmentName));
    scenarios.push({ id: "owner-only-archive-permissions", pass: (archiveDirStat.mode & 0o777) === 0o700 && (archiveFileStat.mode & 0o777) === 0o600, evidence: { dirMode: (archiveDirStat.mode & 0o777).toString(8), fileMode: (archiveFileStat.mode & 0o777).toString(8) } });

    const orphanPrincipal = "p10:archive-before-ledger-crash";
    const orphanDir = principalDir(memoryRoot, orphanPrincipal);
    const orphanNow = new Date(Date.now() - 60_000).toISOString();
    const liveOrphanRecord = {
      id: "p10_orphan_1", document: "MEMORY.md", key: "Crash marker", value: "Live authority", kind: "semantic", confidence: 1, sensitivity: "normal",
      validFrom: orphanNow, createdAt: orphanNow, provenance: { authority: "explicit", channel: "system", observedAt: orphanNow },
    };
    await ledgerLib.writeMemoryLedger(orphanDir, { schemaVersion: 1, updatedAt: orphanNow, records: [liveOrphanRecord] });
    await archiveLib.archiveMemoryRecords(orphanDir, [{ ...liveOrphanRecord, value: "Stale archive copy", retractedAt: new Date().toISOString() }]);
    const orphanHistory = await store.queryAgentMemory(orphanPrincipal, { query: "crash marker", includeHistory: true, limit: 10 });
    scenarios.push({
      id: "archive-before-ledger-crash-live-wins",
      pass: orphanHistory.records.length === 1 && orphanHistory.records[0]?.record.value === "Live authority" && !orphanHistory.records[0]?.record.retractedAt,
      evidence: { returned: orphanHistory.records.length, liveWins: orphanHistory.records[0]?.record.value === "Live authority" },
    });

    const backdatedPrincipal = "p10:backdated-archived-replace";
    const backdatedDir = principalDir(memoryRoot, backdatedPrincipal);
    const archivedOld = {
      id: "p10_archived_old", document: "MEMORY.md", key: "Historical region", value: "Jakarta", kind: "semantic", confidence: 1, sensitivity: "normal",
      validFrom: "2026-01-01T00:00:00.000Z", supersededAt: "2026-06-01T00:00:00.000Z", supersededBy: "historical-successor",
      createdAt: "2026-01-01T00:00:00.000Z", provenance: { authority: "explicit", channel: "system", observedAt: "2026-01-01T00:00:00.000Z" },
    };
    await archiveLib.archiveMemoryRecords(backdatedDir, [archivedOld]);
    await ledgerLib.writeMemoryLedger(backdatedDir, { schemaVersion: 1, updatedAt: "2026-09-03T00:00:00.000Z", records: [] });
    await store.rememberAgentMemory(backdatedPrincipal, "MEMORY.md", "Historical region", "Singapore", {
      mode: "replace", confidence: 0.1, validFrom: "2026-03-01T00:00:00.000Z", provenance: { authority: "observed", channel: "system", observedAt: "2026-09-03T00:00:00.000Z" },
    });
    const backdated = await store.queryAgentMemory(backdatedPrincipal, { query: "historical region", at: "2026-04-01T00:00:00.000Z" });
    scenarios.push({
      id: "backdated-replace-over-immutable-archive",
      pass: backdated.records.length === 1 && backdated.records[0]?.record.value === "Singapore" && backdated.records[0]?.conflicts.length === 0,
      evidence: { value: backdated.records[0]?.record.value ?? null, conflicts: backdated.records[0]?.conflicts.length ?? 0 },
    });

    const frozenPrincipal = "p10:frozen-session";
    await store.rememberAgentMemory(frozenPrincipal, "MEMORY.md", "Session setting", "Old value");
    const sessionA = await session.createAgentSession(frozenPrincipal, "cli", { title: "Frozen A" });
    await store.rememberAgentMemory(frozenPrincipal, "MEMORY.md", "Session setting", "New value");
    const reloadedA = await session.getAgentSession(frozenPrincipal, sessionA.id);
    const sessionB = await session.createAgentSession(frozenPrincipal, "cli", { title: "Fresh B" });
    const resumedA = await session.resumeAgentSession(frozenPrincipal, sessionA.id);
    scenarios.push({
      id: "frozen-session-snapshot",
      pass: Boolean(reloadedA?.memorySnapshot.memory.includes("Old value")) && !reloadedA?.memorySnapshot.memory.includes("New value")
        && sessionB.memorySnapshot.memory.includes("New value") && resumedA.memorySnapshot.memory.includes("Old value") && !resumedA.memorySnapshot.memory.includes("New value"),
      evidence: { sessionAOld: Boolean(reloadedA?.memorySnapshot.memory.includes("Old value")), sessionBNew: sessionB.memorySnapshot.memory.includes("New value"), resumeCopiesFrozenSnapshot: resumedA.memorySnapshot.memory.includes("Old value") },
    });

    const passed = scenarios.filter((item) => item.pass).length;
    return {
      calibrationVersion: "mso-memory-lifecycle-v1",
      scenarioCount: scenarios.length,
      passed,
      accuracyPct: pct(passed, scenarios.length),
      deterministic: true,
      scenarios,
      retention: { triggerSeedRecords: count, finalLiveRecords: liveRaw.records.length, archivedRecords: archived.records.length, archiveSegments: archived.segmentCount, ledgerBytes: telemetry.ledgerBytes, archiveBytes: telemetry.archiveBytes, projectionBytes: telemetry.projectionBytes },
      note: "Runs only in isolated temporary memory/session roots. Cold finished records are archived before the live ledger is replaced; normal resolved reads do not load archive content, while explicit history/time-travel retrieval does.",
    };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const result = await runMemoryLifecycleCalibration();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`MSO memory lifecycle calibration · ${result.passed}/${result.scenarioCount} pass · deterministic=${result.deterministic}`);
    for (const scenario of result.scenarios) console.log(`  ${scenario.pass ? "PASS" : "FAIL"} ${scenario.id}`);
    console.log(`  retention ${result.retention.triggerSeedRecords} seed → ${result.retention.finalLiveRecords} live + ${result.retention.archivedRecords} archived (${result.retention.archiveSegments} segments)`);
  }
  if (result.accuracyPct !== 100 || !result.deterministic) process.exitCode = 1;
}

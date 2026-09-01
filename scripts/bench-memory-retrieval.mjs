#!/usr/bin/env bun
import { queryMemoryLedger } from "../lib/agent/memory-query.ts";

const T = {
  jan: "2026-01-01T00:00:00.000Z", may: "2026-05-01T00:00:00.000Z",
  jun: "2026-06-01T00:00:00.000Z", jul: "2026-07-01T00:00:00.000Z",
};
let seq = 0;
function rec({ key, value, authority = "explicit", confidence = 1, observedAt = T.jan, validFrom = T.jan, ...rest }) {
  seq += 1;
  return {
    id: `bench_${seq}`, document: "MEMORY.md", key, value, kind: "semantic", confidence,
    sensitivity: "normal", validFrom, createdAt: observedAt,
    provenance: { authority, channel: authority === "migration" ? "legacy" : "system", observedAt }, ...rest,
  };
}
function ledger(records) { return { schemaVersion: 1, updatedAt: T.jul, records }; }

const scenarios = [
  {
    id: "keyword-key", category: "retrieval", query: { query: "deployment rollback", at: T.jul },
    ledger: ledger([rec({ key: "Deployment rollback policy", value: "Always verify before rollback" }), rec({ key: "UI preference", value: "Compact sidebar" })]),
    expect: (r) => r.records[0]?.record.key === "Deployment rollback policy",
  },
  {
    id: "keyword-value", category: "retrieval", query: { query: "SvelteKit runes", at: T.jul },
    ledger: ledger([rec({ key: "Frontend rule", value: "Use SvelteKit 5 runes for reactive state" }), rec({ key: "Deploy rule", value: "Use safe build" })]),
    expect: (r) => r.records[0]?.record.key === "Frontend rule",
  },
  {
    id: "temporal-before", category: "temporal", query: { query: "office", at: T.may },
    ledger: ledger([rec({ key: "Office", value: "Jakarta", supersededAt: T.jun, supersededBy: "new" }), rec({ key: "Office", value: "Singapore", validFrom: T.jun, observedAt: T.jun, supersedes: ["bench_old"] })]),
    expect: (r) => r.records[0]?.record.value === "Jakarta",
  },
  {
    id: "temporal-after", category: "temporal", query: { query: "office", at: T.jul },
    ledger: ledger([rec({ key: "Office", value: "Jakarta", supersededAt: T.jun, supersededBy: "new" }), rec({ key: "Office", value: "Singapore", validFrom: T.jun, observedAt: T.jun })]),
    expect: (r) => r.records[0]?.record.value === "Singapore",
  },
  {
    id: "authority", category: "conflict", query: { query: "region", at: T.jul },
    ledger: ledger([rec({ key: "Region", value: "Singapore", authority: "observed", confidence: 1, observedAt: T.jun }), rec({ key: "Region", value: "Jakarta", authority: "explicit", confidence: 0.5, observedAt: T.jan })]),
    expect: (r) => r.records[0]?.record.value === "Jakarta" && r.records[0]?.conflicts.length === 1,
  },
  {
    id: "confidence", category: "conflict", query: { query: "runtime", at: T.jul },
    ledger: ledger([rec({ key: "Runtime", value: "Bun", authority: "observed", confidence: 0.9, observedAt: T.jan }), rec({ key: "Runtime", value: "Node", authority: "observed", confidence: 0.6, observedAt: T.jun })]),
    expect: (r) => r.records[0]?.record.value === "Bun" && r.records[0]?.conflicts.length === 1,
  },
  {
    id: "recency", category: "conflict", query: { query: "branch", at: T.jul },
    ledger: ledger([rec({ key: "Branch", value: "develop", authority: "observed", confidence: 0.8, observedAt: T.jan }), rec({ key: "Branch", value: "main", authority: "observed", confidence: 0.8, observedAt: T.jun })]),
    expect: (r) => r.records[0]?.record.value === "main" && r.records[0]?.conflicts.length === 1,
  },
  {
    id: "retracted", category: "temporal", query: { query: "temporary", at: T.jul },
    ledger: ledger([rec({ key: "Temporary", value: "obsolete", retractedAt: T.jun })]),
    expect: (r) => r.records.length === 0,
  },
];

export function runMemoryRetrievalBenchmark() {
  const rows = scenarios.map((scenario) => {
    const first = queryMemoryLedger(scenario.ledger, scenario.query);
    const second = queryMemoryLedger(scenario.ledger, scenario.query);
    return { id: scenario.id, category: scenario.category, pass: scenario.expect(first), deterministic: JSON.stringify(first) === JSON.stringify(second), top: first.records[0]?.record.value ?? null, conflicts: first.records[0]?.conflicts.length ?? 0 };
  });
  const byCategory = Object.fromEntries(["retrieval", "temporal", "conflict"].map((category) => {
    const subset = rows.filter((row) => row.category === category);
    return [category, { passed: subset.filter((row) => row.pass).length, total: subset.length, accuracyPct: subset.length ? Math.round(subset.filter((row) => row.pass).length / subset.length * 1000) / 10 : 100 }];
  }));
  return { scenarios: rows, deterministic: rows.every((row) => row.deterministic), overallAccuracyPct: Math.round(rows.filter((row) => row.pass).length / rows.length * 1000) / 10, ...byCategory };
}

if (import.meta.main) {
  const result = runMemoryRetrievalBenchmark();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("MSO typed-memory retrieval benchmark");
    console.log(`  overall   ${result.overallAccuracyPct}% · deterministic=${result.deterministic}`);
    for (const category of ["retrieval", "temporal", "conflict"]) console.log(`  ${category.padEnd(9)} ${result[category].accuracyPct}% (${result[category].passed}/${result[category].total})`);
    for (const row of result.scenarios) console.log(`  ${row.pass && row.deterministic ? "PASS" : "FAIL"} ${row.id}`);
  }
  if (!result.deterministic || result.overallAccuracyPct !== 100) process.exitCode = 1;
}

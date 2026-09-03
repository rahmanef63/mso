#!/usr/bin/env bun
import { queryMemoryLedger } from "../lib/agent/memory-query.ts";
import { hybridSemanticScore, prepareSemanticQuery, SKILL_EMBEDDING_VERSION } from "../lib/skills/semantic.ts";

const AT = "2026-09-03T00:00:00.000Z";

function ledger(records) { return { schemaVersion: 1, updatedAt: AT, records }; }
function lexicalTopKey(records, query) { return queryMemoryLedger(ledger(records), { query, at: AT }).records[0]?.record.key ?? null; }
function semanticTopKey(records, query) {
  const prepared = prepareSemanticQuery(query);
  const ranked = records
    .map((record) => ({ key: record.key, score: hybridSemanticScore(prepared, `${record.key}\n${record.value}`) }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return ranked[0]?.score > 0 ? ranked[0].key : null;
}
function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }

export function runMemoryRetrievalCalibration() {
  let seq = 0;
  const rec = (key, value) => ({
    id: `p10_retrieval_${++seq}`,
    document: "MEMORY.md",
    key,
    value,
    kind: "semantic",
    confidence: 1,
    sensitivity: "normal",
    validFrom: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    provenance: { authority: "explicit", channel: "system", observedAt: "2026-01-01T00:00:00.000Z" },
  });

  const retrievalCases = [
    {
      id: "paraphrase-same-concept",
      class: "paraphrase",
      records: [rec("Deployment rollback policy", "Verify service health before rolling back a release"), rec("Frontend convention", "Use Svelte 5 runes")],
      query: "undo release safely",
      expected: "Deployment rollback policy",
    },
    {
      id: "synonym-ide-editor",
      class: "synonym",
      records: [rec("Primary editor", "VS Code"), rec("Primary shell", "zsh")],
      query: "IDE preference",
      expected: "Primary editor",
    },
    {
      id: "bilingual-office-kantor",
      class: "bilingual",
      records: [rec("Office location", "Jakarta"), rec("Release region", "Singapore")],
      query: "kantor utama",
      expected: "Office location",
    },
    {
      id: "long-value-tail",
      class: "long-value",
      records: [rec("Release handbook", `${"Operational notes. ".repeat(80)}Before rollback always verify service health and preserve evidence.`), rec("Design handbook", "Use compact mobile navigation")],
      query: "verify service health",
      expected: "Release handbook",
    },
    {
      id: "similar-keys-disambiguation",
      class: "similar-keys",
      records: [rec("Primary database", "PostgreSQL"), rec("Analytics database", "ClickHouse"), rec("Archive database", "SQLite")],
      query: "analytics database",
      expected: "Analytics database",
    },
    {
      id: "exact-domain-phrase",
      class: "lexical-control",
      records: [rec("Deployment rollback policy", "Verify service health"), rec("Deployment region", "Jakarta")],
      query: "deployment rollback",
      expected: "Deployment rollback policy",
    },
  ];

  const retrieval = retrievalCases.map((row) => {
    const first = lexicalTopKey(row.records, row.query), second = lexicalTopKey(row.records, row.query);
    return { id: row.id, class: row.class, pass: first === row.expected, deterministic: first === second, topKey: first };
  });
  const semantic = retrievalCases.map((row) => {
    const first = semanticTopKey(row.records, row.query), second = semanticTopKey(row.records, row.query);
    return { id: row.id, class: row.class, pass: first === row.expected, deterministic: first === second, topKey: first };
  });

  const graphCases = [
    { id: "ownership-dependency", first: "Atlas", intermediate: "Beacon", second: "Core", records: [rec("Atlas ownership", "Atlas owns Beacon"), rec("Beacon dependency", "Beacon depends on Core"), rec("Unrelated preference", "Compact UI")] },
    { id: "service-team", first: "Orchid", intermediate: "Platform", second: "Infra", records: [rec("Orchid owner", "Orchid is owned by Platform"), rec("Platform dependency", "Platform depends on Infra"), rec("Theme", "Dark") ] },
    { id: "module-package", first: "Renderer", intermediate: "Scene", second: "Assets", records: [rec("Renderer relation", "Renderer uses Scene"), rec("Scene relation", "Scene consumes Assets"), rec("Editor", "VS Code") ] },
  ];

  const graph = graphCases.map((row) => {
    const firstHop = queryMemoryLedger(ledger(row.records), { query: row.first, at: AT }).records.map((item) => `${item.record.key} ${item.record.value}`);
    const secondHop = queryMemoryLedger(ledger(row.records), { query: row.intermediate, at: AT }).records.map((item) => `${item.record.key} ${item.record.value}`);
    const pass = firstHop.some((text) => text.includes(row.intermediate)) && secondHop.some((text) => text.includes(row.second));
    return { id: row.id, pass, hops: 2, firstHopRows: firstHop.length, secondHopRows: secondHop.length };
  });

  const retrievalPassed = retrieval.filter((row) => row.pass && row.deterministic).length;
  const semanticPassed = semantic.filter((row) => row.pass && row.deterministic).length;
  const lexicalMisses = retrieval.filter((row) => !row.pass).map((row) => row.id);
  const semanticMisses = semantic.filter((row) => !row.pass).map((row) => row.id);
  const graphPassed = graph.filter((row) => row.pass).length;
  const candidateImprovesRecall = semanticPassed > retrievalPassed;

  return {
    calibrationVersion: "mso-memory-retrieval-calibration-v2",
    retrieval: { passed: retrievalPassed, total: retrieval.length, accuracyPct: pct(retrievalPassed, retrieval.length), deterministic: retrieval.every((row) => row.deterministic), rows: retrieval },
    semanticCandidate: {
      encoder: SKILL_EMBEDDING_VERSION,
      mode: "existing-local-ephemeral-hybrid",
      networkCalls: 0,
      persistedMemoryVectors: 0,
      passed: semanticPassed,
      total: semantic.length,
      accuracyPct: pct(semanticPassed, semantic.length),
      deterministic: semantic.every((row) => row.deterministic),
      deltaPassedVsLexical: semanticPassed - retrievalPassed,
      rows: semantic,
    },
    semanticEvidenceGate: {
      objectiveLexicalMisses: lexicalMisses,
      candidateMisses: semanticMisses,
      candidateImprovesRecall,
      vectorLayerRequired: false,
      reason: candidateImprovesRecall
        ? "The existing local semantic encoder improves this bounded fixture, but production memory vectors remain blocked until privacy, latency and index lifecycle costs are calibrated."
        : "The existing local semantic encoder does not improve this bounded memory fixture, so reusing it for production memory retrieval would add vector/index complexity without a recall benefit.",
    },
    graph: { passed: graphPassed, total: graph.length, rows: graph, graphStorageRequired: graphPassed !== graph.length },
    note: "This is a bounded synthetic evidence gate. The semantic candidate is the repo's existing local skill-routing encoder and is evaluated ephemerally with no network call or persisted memory vector. Graph rows prove only whether these small relationship chains remain reachable through explicit two-step retrieval; neither result is a universal retrieval/reasoning claim.",
  };
}

if (import.meta.main) {
  const result = runMemoryRetrievalCalibration();
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`MSO memory retrieval calibration · lexical ${result.retrieval.passed}/${result.retrieval.total} · local semantic ${result.semanticCandidate.passed}/${result.semanticCandidate.total}`);
    for (const row of result.retrieval.rows) console.log(`  lexical  ${row.pass && row.deterministic ? "PASS" : "MISS"} ${row.id}`);
    for (const row of result.semanticCandidate.rows) console.log(`  semantic ${row.pass && row.deterministic ? "PASS" : "MISS"} ${row.id}`);
    console.log(`  semantic gate: ${result.semanticEvidenceGate.vectorLayerRequired ? "vector candidate" : "vector blocked"} · delta=${result.semanticCandidate.deltaPassedVsLexical}`);
    console.log(`  graph gate: ${result.graph.passed}/${result.graph.total} two-hop fixtures · graph storage ${result.graph.graphStorageRequired ? "candidate" : "blocked"}`);
  }
  if (!result.retrieval.deterministic || !result.semanticCandidate.deterministic || result.graph.passed !== result.graph.total) process.exitCode = 1;
}

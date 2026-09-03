import { aggregateAgent, eligibleRanking } from "./bench-agent-metrics.mjs";

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function sortedUnique(values) { return [...new Set(values)].sort(); }
function signature(values) { return sortedUnique(values).join("|"); }
function sameArray(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function finiteValues(values) { return values.filter((value) => Number.isFinite(value)); }
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}
function rounded(value, decimals = 1) { const scale = 10 ** decimals; return Math.round(value * scale) / scale; }

export function describeObservedRuns(values) {
  const rows = finiteValues(values);
  if (!rows.length) return { count: 0, min: null, max: null, mean: null, median: null, range: null, sampleStdDev: null, coefficientOfVariationPct: null };
  const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const variance = rows.length > 1 ? rows.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (rows.length - 1) : null;
  const sampleStdDev = variance == null ? null : Math.sqrt(variance);
  return {
    count: rows.length, min: Math.min(...rows), max: Math.max(...rows), mean: rounded(mean), median: median(rows),
    range: rounded(Math.max(...rows) - Math.min(...rows)),
    sampleStdDev: sampleStdDev == null ? null : rounded(sampleStdDev),
    coefficientOfVariationPct: sampleStdDev == null || mean === 0 ? null : rounded((sampleStdDev / Math.abs(mean)) * 100),
  };
}

/**
 * @param {Array<any>} runs
 * @param {{agents:string[], expectedRuns:number, plan?:Array<{runIndex:number,seed:string,agentOrder:string[]}>, provider?:string|null, model?:string|null}} options
 */
export function summarizeRepeatedCorpus(runs, { agents, expectedRuns, plan = [], provider = null, model = null }) {
  const completed = runs.filter((run) => run?.run === true);
  const versions = new Set(completed.map((run) => run.corpusVersion));
  const scenarioCounts = new Set(completed.map((run) => run.scenarioCount));
  const scenarioSignatures = new Set(completed.map((run) => signature((run.rows || []).map((row) => row.scenarioId))));
  const providers = new Set(completed.map((run) => String(run.provider || "").toLowerCase()).filter(Boolean));
  const models = new Set(completed.map((run) => String(run.model || "")).filter(Boolean));
  const scenarioCount = scenarioCounts.size === 1 ? [...scenarioCounts][0] : null;
  const scenarioSignature = scenarioSignatures.size === 1 ? [...scenarioSignatures][0] : null;
  const expectedAttempts = scenarioCount == null ? null : expectedRuns * scenarioCount;
  const exactRunCount = runs.length === expectedRuns && completed.length === expectedRuns;
  const plannedIdentity = plan.length === expectedRuns && runs.every((run, index) => {
    const expected = plan[index];
    return run?.runIndex === expected?.runIndex && run?.seed === expected?.seed
      && sameArray(run?.agentOrder, expected?.agentOrder);
  });
  const requestedAgents = [...agents].sort();
  const exactScenarioCoverage = scenarioCount != null && Boolean(scenarioSignature) && completed.every((run) => {
    const rows = run.rows || [];
    const rowAgents = sortedUnique(rows.map((row) => row.agent));
    if (!sameArray(rowAgents, requestedAgents) || rows.length !== scenarioCount * agents.length) return false;
    return agents.every((agent) => {
      const ids = rows.filter((row) => row.agent === agent).map((row) => row.scenarioId);
      return ids.length === scenarioCount && new Set(ids).size === scenarioCount && signature(ids) === scenarioSignature;
    });
  });
  const expectedProvider = provider ? String(provider).toLowerCase() : null;
  const providerIdentity = providers.size === 1 && (!expectedProvider || providers.has(expectedProvider));
  const modelIdentity = models.size === 1 && (!model || models.has(String(model)));
  const providerModelIdentity = completed.length > 0 && providerIdentity && modelIdentity;
  const exactCoverage = exactRunCount && plannedIdentity && exactScenarioCoverage && providerModelIdentity;
  const providerModelComparable = exactCoverage && completed.every((run) => run.comparability?.level === "full");
  const tokenSemanticsComparable = providerModelComparable && completed.every((run) => run.efficiencyComparability?.tokenSemanticsComparable === true);
  const costSemanticsComparable = providerModelComparable && completed.every((run) => run.efficiencyComparability?.costSemanticsComparable === true);
  const allRows = completed.flatMap((run) => run.rows || []);
  const aggregates = agents.map((agent) => {
    const aggregate = aggregateAgent(agent, allRows.filter((row) => row.agent === agent));
    const perRun = completed.map((run) => run.aggregates?.find((row) => row.agent === agent)).filter(Boolean);
    const perfectRuns = perRun.filter((row) => row.fullSuccess === true).length;
    return {
      ...aggregate, perfectRuns, perfectRunPct: pct(perfectRuns, expectedRuns),
      observedRunDistribution: {
        taskSuccessPct: describeObservedRuns(perRun.map((row) => row.taskSuccessPct)),
        averageLatencyMs: describeObservedRuns(perRun.map((row) => row.averageLatencyMs)),
        p50LatencyMs: describeObservedRuns(perRun.map((row) => row.p50LatencyMs)),
        normalizedTokensPerAttempt: describeObservedRuns(perRun.map((row) => row.reportedTokensPerAttempt)),
      },
    };
  });
  const repeatComparable = providerModelComparable && versions.size === 1 && scenarioCounts.size === 1 && scenarioSignatures.size === 1;
  const ranking = exactCoverage && expectedAttempts != null
    ? eligibleRanking(aggregates, repeatComparable ? { level: "full" } : { level: "uncomparable" }, expectedAttempts)
    : { eligible: false, reason: "every requested run and agent must cover the same complete corpus/provider/model identity" };
  return {
    requestedRuns: expectedRuns,
    completedRuns: completed.length,
    corpusVersion: versions.size === 1 ? [...versions][0] : null,
    scenarioCount,
    scenarioSignature,
    exactCoverage,
    exactScenarioCoverage,
    plannedIdentity,
    providerModelIdentity,
    comparability: { level: repeatComparable ? "full" : "uncomparable", ...(repeatComparable ? {} : { reason: "repeat aggregation requires complete matching corpus/provider/model evidence" }) },
    efficiencyComparability: { tokenSemanticsComparable, costSemanticsComparable },
    aggregates,
    ranking,
  };
}

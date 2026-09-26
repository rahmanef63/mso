import { hostCredentialStore } from "@/lib/config/store";
import { safeProviderFetch } from "@/lib/host/ssrf";
import type { WorkflowOptimizerCandidate, WorkflowOptimizerEvaluation } from "./graph-optimizer";

export const DEFAULT_JEV_OPENROUTER_MODEL = "~typesafe/jev-latest";
const OPENROUTER_JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function probability(answer: unknown): number | null {
  if (!object(answer)) return null;
  const value = Number(answer.noul);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function createOpenRouterJevWorkflowOptimizerEvaluator(config: { model?: string } = {}) {
  const model = typeof config.model === "string" && config.model.trim() ? config.model.trim() : DEFAULT_JEV_OPENROUTER_MODEL;
  if (model.length > 180) throw new Error("invalid Jev OpenRouter model");

  return async (state: Record<string, unknown>, candidates: WorkflowOptimizerCandidate[]): Promise<WorkflowOptimizerEvaluation> => {
    if (!candidates.length) return { provider: "jev", probabilities: {} };
    const apiKey = await hostCredentialStore().getKey(undefined, "openrouter");
    if (!apiKey) throw new Error("OpenRouter is not connected. Add an OpenRouter key in Settings → AI or Integrations → AI Providers.");

    const mapping = new Map<string, string>();
    const questions = Object.fromEntries(candidates.slice(0, 16).map((candidate, index) => {
      const key = `q${index + 1}`;
      mapping.set(key, candidate.id);
      return [key, {
        type: "noul",
        instructions: `Should MSO apply candidate "${candidate.title}"? Answer yes only when it meaningfully improves or compacts this workflow while preserving semantics, permissions, bounded execution, auditability and debuggability. Candidate risk: ${candidate.risk}.`,
      }];
    }));

    const response = await safeProviderFetch(OPENROUTER_JEV_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-title": "MSO JEV Decision Kernel",
      },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`OpenRouter Jev request failed (${response.status})`);
    const payload = await response.json() as unknown;
    if (!object(payload) || !object(payload.answers)) throw new Error("OpenRouter Jev returned no typed answers");

    const probabilities: Record<string, number> = {};
    for (const [question, candidateId] of mapping) {
      const p = probability(payload.answers[question]);
      if (p !== null) probabilities[candidateId] = p;
    }
    if (!Object.keys(probabilities).length) throw new Error("OpenRouter Jev returned no usable probabilities");
    return { provider: "jev", probabilities };
  };
}

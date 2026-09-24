import { executeIntegrationAction } from "@/lib/infra/connection-dispatch";
import type { WorkflowOptimizerCandidate, WorkflowOptimizerEvaluation } from "./graph-optimizer";

type JevOptimizerConnection = {
  user: string;
  connection: string;
  tool?: string;
  model?: string;
};

type ToolDescriptor = { name: string; inputSchema: Record<string, unknown> };

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJsonText(value: unknown): unknown {
  if (!object(value) || !Array.isArray(value.content)) return null;
  const text = value.content
    .filter((item): item is Record<string, unknown> => object(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text))
    .join("\n");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function structured(value: unknown): Record<string, unknown> {
  let current: unknown = value;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!object(current)) break;
    if (object(current.structuredContent)) return current.structuredContent;
    const parsed = parseJsonText(current);
    if (object(parsed)) return parsed;
    if (object(current.data)) current = current.data;
    else if (object(current.result)) current = current.result;
    else break;
  }
  if (object(current)) return current;
  throw new Error("Jev MCP returned no structured decision payload");
}

function listedTools(value: unknown): ToolDescriptor[] {
  if (!object(value)) return [];
  const result = value.result;
  const rows = Array.isArray(result) ? result : Array.isArray(value.tools) ? value.tools : [];
  return rows.filter((row): row is ToolDescriptor =>
    object(row) && typeof row.name === "string" && object(row.inputSchema),
  );
}

function schemaProperties(tool: ToolDescriptor): Record<string, unknown> {
  return object(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
}

function probability(answer: unknown): number | null {
  if (!object(answer)) return null;
  for (const key of ["noul", "probability", "confidence", "certainty"]) {
    const value = Number(answer[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
  }
  return null;
}

async function mcpCall(config: JevOptimizerConnection, tool: string, args: Record<string, unknown>) {
  return executeIntegrationAction({
    user: config.user,
    provider: "mcp",
    connection: config.connection,
    operation: "mcp.tool",
    confirm: true,
    arguments: { name: tool, arguments: args },
  });
}

async function evaluateTypedQuestions(
  config: JevOptimizerConnection,
  tool: ToolDescriptor,
  state: Record<string, unknown>,
  candidates: WorkflowOptimizerCandidate[],
): Promise<Record<string, number>> {
  const mapping = new Map<string, string>();
  const questions = Object.fromEntries(candidates.slice(0, 16).map((candidate, index) => {
    const key = `q${index + 1}`;
    mapping.set(key, candidate.id);
    return [key, {
      type: "noul",
      instructions: `Should MSO apply candidate "${candidate.title}"? Answer yes only when it meaningfully compacts this workflow while preserving declared semantics, bounded execution, permissions and debuggability. Candidate risk: ${candidate.risk}.`,
    }];
  }));
  const props = schemaProperties(tool);
  const payload = structured(await mcpCall(config, tool.name, {
    state,
    questions,
    ...(config.model && Object.hasOwn(props, "model") ? { model: config.model } : {}),
  }));
  const answers = object(payload.answers) ? payload.answers : object(payload.data) && object(payload.data.answers) ? payload.data.answers : null;
  if (!answers) throw new Error("Jev typed response did not contain answers");
  const probabilities: Record<string, number> = {};
  for (const [question, candidateId] of mapping) {
    const p = probability(answers[question]);
    if (p !== null) probabilities[candidateId] = p;
  }
  return probabilities;
}

async function evaluateBoundedDecisions(
  config: JevOptimizerConnection,
  tool: ToolDescriptor,
  state: Record<string, unknown>,
  candidates: WorkflowOptimizerCandidate[],
): Promise<Record<string, number>> {
  const probabilities: Record<string, number> = {};
  const evidence = JSON.stringify(state).slice(0, 12_000);
  const props = schemaProperties(tool);
  for (const candidate of candidates.slice(0, 12)) {
    const payload = structured(await mcpCall(config, tool.name, {
      decision: `Should MSO apply this workflow optimization: ${candidate.title}?`,
      evidence: `${evidence}\nCandidate: ${candidate.description}\nAffected nodes: ${candidate.nodeIds.length}. Estimated node delta: ${candidate.estimatedNodeDelta}.`,
      priorities: "Preserve workflow semantics, permission boundaries, bounded execution and debuggability. Prefer compaction only when evidence supports it. Review-risk transformations must be treated conservatively.",
      candidates: [
        { id: "apply", description: "Apply this exact host-generated optimization candidate." },
        { id: "skip", description: "Keep the current workflow unchanged for this candidate." },
      ],
      requirements: [
        "The candidate must not create a new tool call or new arguments.",
        "The candidate must not weaken MSO authorization, confirmation, retry, idempotency or audit boundaries.",
        "The candidate should meaningfully reduce visual or structural workflow complexity.",
      ],
      ...(config.model && Object.hasOwn(props, "model") ? { model: config.model } : {}),
    }));
    const recommendation = object(payload.recommendation) ? payload.recommendation : payload;
    const distribution = object(recommendation.probabilities) ? recommendation.probabilities : {};
    const apply = Number(distribution.apply);
    if (Number.isFinite(apply) && apply >= 0 && apply <= 1) probabilities[candidate.id] = apply;
    else if (recommendation.selected === "apply") probabilities[candidate.id] = probability(recommendation) ?? 1;
    else if (recommendation.selected === "skip") probabilities[candidate.id] = 1 - (probability(recommendation) ?? 1);
  }
  return probabilities;
}

export function createJevWorkflowOptimizerEvaluator(config: JevOptimizerConnection) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(config.user)) throw new Error("invalid Jev integration user");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(config.connection)) throw new Error("invalid Jev integration connection");
  if (config.tool && !/^[A-Za-z0-9_.-]{1,128}$/.test(config.tool)) throw new Error("invalid Jev MCP tool");

  return async (state: Record<string, unknown>, candidates: WorkflowOptimizerCandidate[]): Promise<WorkflowOptimizerEvaluation> => {
    if (!candidates.length) return { provider: "jev", probabilities: {} };
    const catalog = await executeIntegrationAction({
      user: config.user,
      provider: "mcp",
      connection: config.connection,
      operation: "mcp.tools.list",
      confirm: true,
      arguments: {},
    });
    const tools = listedTools(catalog);
    const tool = config.tool
      ? tools.find((row) => row.name === config.tool)
      : tools.find((row) => row.name === "jev_decide") ?? tools.find((row) => row.name === "evaluate") ?? tools.find((row) => /(?:jev_)?(?:decide|evaluate)$/i.test(row.name));
    if (!tool) throw new Error(config.tool ? `Configured Jev MCP tool "${config.tool}" was not advertised` : "Jev MCP advertised no supported decision tool");

    const props = schemaProperties(tool);
    let probabilities: Record<string, number>;
    if (Object.hasOwn(props, "questions") && Object.hasOwn(props, "state")) {
      probabilities = await evaluateTypedQuestions(config, tool, state, candidates);
    } else if (Object.hasOwn(props, "decision") && Object.hasOwn(props, "candidates")) {
      probabilities = await evaluateBoundedDecisions(config, tool, state, candidates);
    } else {
      throw new Error(`Unsupported Jev tool schema for ${tool.name}`);
    }
    if (!Object.keys(probabilities).length) throw new Error("Jev MCP response contained no usable probabilities");
    return { provider: "jev", probabilities };
  };
}

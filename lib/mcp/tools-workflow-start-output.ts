import { WORKFLOW_PROGRESS_OUTPUT, workflowProgress } from "./tools-learning-shared";

export const WORKFLOW_START_OUTPUT = {
  ...WORKFLOW_PROGRESS_OUTPUT,
  properties: {
    ...WORKFLOW_PROGRESS_OUTPUT.properties,
    context: {
      type: "object",
      properties: {
        memory: {
          type: "array", maxItems: 10, items: {
            type: "object",
            properties: {
              source: { type: "string", enum: ["agent", "project"] },
              ref: { type: "string" },
              kind: { type: "string" },
              title: { type: "string" },
              text: { type: "string" },
              score: { type: "number" },
              lastVerified: { type: "string" },
            },
            required: ["source", "ref", "text"], additionalProperties: false,
          },
        },
        recipe: {
          type: "object",
          properties: {
            id: { type: "string" },
            maturity: { type: "string", enum: ["observed", "candidate", "verified"] },
            attempts: { type: "number" },
            successRate: { type: "number" },
            tools: { type: "array", maxItems: 12, items: { type: "string" } },
            instruction: { type: "string" },
          },
          required: ["id", "maturity", "attempts", "successRate", "tools"], additionalProperties: false,
        },
        memoryHits: { type: "number" },
      },
      required: ["memory", "memoryHits"], additionalProperties: false,
    },
  },
} as const;

function compactContextText(value: unknown, max = 700): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

export function workflowStartProjection(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const row = result as Record<string, unknown>;
  const progress = workflowProgress(row.workflow, true);
  if (!progress) return undefined;
  const bootstrap = row.bootstrap && typeof row.bootstrap === "object" ? row.bootstrap as Record<string, unknown> : {};
  const orchestration = bootstrap.orchestration && typeof bootstrap.orchestration === "object"
    ? bootstrap.orchestration as Record<string, unknown> : {};
  const memory: Array<Record<string, unknown>> = [];

  if (Array.isArray(orchestration.agentMemory)) {
    for (const candidate of orchestration.agentMemory.slice(0, 5)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Record<string, unknown>;
      const ref = compactContextText(item.ref, 160), text = compactContextText(item.value, 700);
      if (!ref || !text) continue;
      memory.push({
        source: "agent", ref, text,
        ...(typeof item.kind === "string" ? { kind: item.kind.slice(0, 40) } : {}),
        ...(typeof item.key === "string" ? { title: compactContextText(item.key, 160) } : {}),
        ...(typeof item.score === "number" && Number.isFinite(item.score) ? { score: item.score } : {}),
      });
    }
  }
  if (Array.isArray(orchestration.memory)) {
    for (const candidate of orchestration.memory.slice(0, 5)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Record<string, unknown>;
      const ref = compactContextText(item.id, 160);
      const text = compactContextText(item.summary, 700);
      if (!ref || !text) continue;
      memory.push({
        source: "project", ref, text,
        ...(typeof item.kind === "string" ? { kind: item.kind.slice(0, 40) } : {}),
        ...(typeof item.title === "string" ? { title: compactContextText(item.title, 160) } : {}),
        ...(typeof item.score === "number" && Number.isFinite(item.score) ? { score: item.score } : {}),
        ...(typeof item.lastVerified === "string" ? { lastVerified: item.lastVerified.slice(0, 48) } : {}),
      });
    }
  }

  const recipeRow = orchestration.recipe && typeof orchestration.recipe === "object"
    ? orchestration.recipe as Record<string, unknown> : undefined;
  let recipe: Record<string, unknown> | undefined;
  if (recipeRow && typeof recipeRow.id === "string") {
    const maturity = ["observed", "candidate", "verified"].includes(String(recipeRow.maturity))
      ? String(recipeRow.maturity) : "candidate";
    const tools = Array.isArray(recipeRow.steps)
      ? recipeRow.steps.slice(0, 12).flatMap((candidate) => {
          if (!candidate || typeof candidate !== "object") return [];
          const tool = (candidate as Record<string, unknown>).tool;
          return typeof tool === "string" && tool ? [tool.slice(0, 100)] : [];
        })
      : [];
    recipe = {
      id: recipeRow.id.slice(0, 160),
      maturity,
      attempts: Math.max(0, Number(recipeRow.attempts) || 0),
      successRate: Math.max(0, Math.min(100, Number(recipeRow.successRate) || 0)),
      tools,
      ...(typeof recipeRow.instruction === "string"
        ? { instruction: compactContextText(recipeRow.instruction, 500) } : {}),
    };
  }
  return {
    ...progress,
    context: {
      memory: memory.slice(0, 10),
      memoryHits: Number.isFinite(Number(orchestration.memoryHits))
        ? Math.max(0, Math.min(100, Math.round(Number(orchestration.memoryHits))))
        : memory.length + (recipe ? 1 : 0),
      ...(recipe ? { recipe } : {}),
    },
  };
}

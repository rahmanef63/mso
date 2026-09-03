import type { EvidenceInput } from "@/lib/orchestration/types";
import type { McpTool } from "./tool-kit";
import { visibleToolsForProfile, type McpToolProfile } from "./tool-contract";

export function optionalStringList(value: unknown, max = 40): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, max) : [];
}

export function evidenceInput(value: unknown): EvidenceInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  return {
    ...(typeof row.environment === "string" && row.environment ? { environment: row.environment } : {}),
    claims: optionalStringList(row.claims), tests: optionalStringList(row.tests), build: optionalStringList(row.build),
    deployment: optionalStringList(row.deployment), health: optionalStringList(row.health), artifacts: optionalStringList(row.artifacts),
    manualVerification: optionalStringList(row.manual_verification), knownRisks: optionalStringList(row.known_risks),
  };
}

export function evidenceSchema() {
  const list = { type: "array", maxItems: 40, items: { type: "string" } };
  return {
    type: "object", description: "Structured verification evidence. Required for success on new HIGH-risk workflows.",
    properties: {
      environment: { type: "string" }, claims: list, tests: list, build: list, deployment: list, health: list, artifacts: list,
      manual_verification: list, known_risks: list,
    },
    additionalProperties: false,
  };
}

export async function visibleTools(scope: "read" | "write" | "exec", profile: McpToolProfile = "full"): Promise<McpTool[]> {
  const { TOOLS } = await import("./tools");
  return visibleToolsForProfile(TOOLS, scope, profile);
}

export const WORKFLOW_PROGRESS_OUTPUT = {
  type: "object",
  properties: {
    active: { type: "boolean" }, workflowId: { type: "string" }, intent: { type: "string" }, project: { type: "string" },
    startedAt: { type: "string" }, elapsedMs: { type: "number" }, stepCount: { type: "number" },
    steps: {
      type: "array", items: {
        type: "object",
        properties: {
          tool: { type: "string" },
          state: { type: "string", enum: ["completed", "failed", "denied", "rate_limited", "invalid_args"] },
          durationMs: { type: "number" }, ts: { type: "string" },
        },
        required: ["tool", "state", "ts"], additionalProperties: false,
      },
    },
  },
  required: ["active", "workflowId", "stepCount", "steps"], additionalProperties: false,
} as const;

type WorkflowProgressStep = {
  tool: string; state: "completed" | "failed" | "denied" | "rate_limited" | "invalid_args"; durationMs?: number; ts: string;
};

function projectLabel(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const label = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  return label.slice(0, 120) || undefined;
}

function workflowSteps(value: unknown): WorkflowProgressStep[] {
  if (!Array.isArray(value)) return [];
  const out: WorkflowProgressStep[] = [];
  for (const candidate of value.slice(-8)) {
    if (!candidate || typeof candidate !== "object") continue;
    const step = candidate as Record<string, unknown>;
    const state = step.state;
    if (typeof step.tool !== "string" || typeof step.ts !== "string") continue;
    if (state !== "completed" && state !== "failed" && state !== "denied" && state !== "rate_limited" && state !== "invalid_args") continue;
    out.push({ tool: step.tool.slice(0, 100), state,
      ...(typeof step.durationMs === "number" && Number.isFinite(step.durationMs) ? { durationMs: Math.max(0, step.durationMs) } : {}), ts: step.ts });
  }
  return out;
}

export function workflowProgress(value: unknown, active: boolean): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const workflow = value as Record<string, unknown>;
  if (typeof workflow.id !== "string" || !workflow.id) return undefined;
  const allSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const startedAt = typeof workflow.startedAt === "string" ? workflow.startedAt : undefined;
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const label = projectLabel(workflow.project);
  return { active, workflowId: workflow.id,
    ...(typeof workflow.intent === "string" && workflow.intent ? { intent: workflow.intent.slice(0, 1000) } : {}),
    ...(label ? { project: label } : {}), ...(startedAt ? { startedAt } : {}),
    ...(Number.isFinite(started) ? { elapsedMs: Math.max(0, Date.now() - started) } : {}),
    stepCount: allSteps.length, steps: workflowSteps(allSteps) };
}

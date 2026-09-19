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
          replay: {
            type: "array", maxItems: 4, items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["file", "job", "artifact", "cursor"] },
                path: { type: "string" }, sha256: { type: "string" }, jobId: { type: "string" },
                artifactId: { type: "string" }, cursor: { type: "string" }, truncated: { type: "boolean" },
                rereadWith: { type: "string", enum: ["fs_read", "read_pipeline", "exec_job_status", "session_artifacts", "project_candidate_search"] },
              },
              required: ["kind"], additionalProperties: false,
            },
          },
        },
        required: ["tool", "state", "ts"], additionalProperties: false,
      },
    },
  },
  required: ["active", "workflowId", "stepCount", "steps"], additionalProperties: false,
} as const;

type WorkflowProgressStep = {
  tool: string; state: "completed" | "failed" | "denied" | "rate_limited" | "invalid_args"; durationMs?: number; ts: string;
  replay?: Array<{
    kind: "file" | "job" | "artifact" | "cursor"; path?: string; sha256?: string; jobId?: string;
    artifactId?: string; cursor?: string; truncated?: boolean; rereadWith?: string;
  }>;
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
    const replay: NonNullable<WorkflowProgressStep["replay"]> = [];
    if (Array.isArray(step.replay)) {
      for (const value of step.replay.slice(-4)) {
        if (!value || typeof value !== "object") continue;
        const row = value as Record<string, unknown>;
        const kind = row.kind;
        if (kind !== "file" && kind !== "job" && kind !== "artifact" && kind !== "cursor") continue;
        replay.push({
          kind,
          ...(typeof row.path === "string" ? { path: row.path.slice(0, 512) } : {}),
          ...(typeof row.sha256 === "string" ? { sha256: row.sha256.slice(0, 80) } : {}),
          ...(typeof row.jobId === "string" ? { jobId: row.jobId.slice(0, 160) } : {}),
          ...(typeof row.artifactId === "string" ? { artifactId: row.artifactId.slice(0, 160) } : {}),
          ...(typeof row.cursor === "string" ? { cursor: row.cursor.slice(0, 512) } : {}),
          ...(row.truncated === true ? { truncated: true } : {}),
          ...(typeof row.rereadWith === "string" ? { rereadWith: row.rereadWith.slice(0, 40) } : {}),
        });
      }
    }
    out.push({ tool: step.tool.slice(0, 100), state,
      ...(typeof step.durationMs === "number" && Number.isFinite(step.durationMs) ? { durationMs: Math.max(0, step.durationMs) } : {}),
      ts: step.ts, ...(replay.length ? { replay } : {}) });
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

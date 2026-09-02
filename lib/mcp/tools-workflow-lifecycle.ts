import { inspectProject, resolveProjectHint } from "@/lib/host";
import { activeWorkflowForActor, cancelWorkflow, finishWorkflow } from "@/lib/workflow";
import { assessAutomationPromotion, buildAutomationScriptManifest, workflowCleanupGuidance } from "@/lib/orchestration/automation";
import { classifyTask } from "@/lib/orchestration/classifier";
import { buildEvidenceReceipt, validateEvidenceReceipt } from "@/lib/orchestration/evidence";
import { upsertRepoMemory } from "@/lib/orchestration/repo-memory";
import { writeAutomationScript, writeEvidenceReceipt, writePortableRecipe } from "@/lib/orchestration/repo-memory-artifacts";
import type { McpTool } from "./tool-kit";
import { opt, S, str } from "./tool-kit";
import { evidenceInput, evidenceSchema, WORKFLOW_PROGRESS_OUTPUT, workflowProgress } from "./tools-learning-shared";

export const WORKFLOW_LIFECYCLE_TOOLS: McpTool[] = [
  {
    name: "workflow_status",
    description:
      "Return a redacted live status snapshot for one workflow. This tool exists for the MSO ChatGPT progress widget: it exposes only workflow identity, timing and high-level tool outcomes, never tool arguments, command strings, file contents or credentials.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: WORKFLOW_PROGRESS_OUTPUT,
    meta: {
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
    },
    limit: { key: "workflow.status", max: 30, windowMs: 60_000 },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
    }),
    run: async (a, context) => {
      const workflowId = str(a, "workflow_id");
      const workflow = await activeWorkflowForActor(context.workflowActor ?? context.actor, workflowId);
      if (!workflow) {
        return { active: false, workflowId, stepCount: 0, steps: [] };
      }
      return workflowProgress(workflow, true)!;
    },
  },
  {
    name: "workflow_cancel",
    description:
      "Cancel one exact active workflow without saving a learned recipe. Use this only when the task is being abandoned or the prior run was interrupted; " +
      "workflow_id is required so a different conversation cannot be cancelled accidentally.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.cancel" as const, targetArg: "workflow_id" },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
      reason: { type: "string", description: "Optional concise reason; no secrets or file contents." },
    }, ["workflow_id"]),
    run: async (a, context) => {
      const cancelled = await cancelWorkflow({
        actor: context.workflowActor ?? context.actor,
        workflowId: str(a, "workflow_id"),
        reason: opt(a, "reason"),
      });
      return { ...cancelled, cleanup: workflowCleanupGuidance(cancelled.workflow.orchestration) };
    },
  },
  {
    name: "workflow_finish",
    description:
      "Finish one exact learned workflow after verification. workflow_id is required so another conversation using the same token cannot close the wrong run. " +
      "MSO saves a redacted Evidence Receipt, task/failure memory, recipe quality, and safe automation-promotion metadata. New HIGH-risk workflows cannot claim success without explicit evidence.",
    scope: "write",
    annotations: { idempotentHint: false },
    limit: { key: "workflow.memory", max: 30, windowMs: 60_000 },
    audit: { action: "workflow.finish" as const, targetArg: "workflow_id" },
    inputSchema: S({
      workflow_id: { type: "string", description: "Exact id returned by workflow_start." },
      summary: { type: "string", description: "Concise outcome and verification result; no secrets." },
      success: { type: "boolean", description: "True only after the requested result is verified." },
      evidence: evidenceSchema(),
    }, ["workflow_id", "summary", "success"]),
    run: async (a, context) => {
      const actor = context.workflowActor ?? context.actor;
      const workflowId = str(a, "workflow_id");
      const summary = str(a, "summary");
      const success = a.success === true;
      const workflow = await activeWorkflowForActor(actor, workflowId);
      if (!workflow) throw new Error("workflow_id was not found for this MSO session");
      const project = workflow.project ? await resolveProjectHint(workflow.project).catch(() => null) : null;
      const finalRepository = project
        ? await inspectProject(project, { includeGitStatus: context.scope === "exec" }).catch(() => undefined)
        : undefined;
      const risk = workflow.orchestration?.risk ?? classifyTask({
        intent: workflow.intent, constraints: workflow.constraints, scope: context.scope,
      }).risk;
      const suppliedEvidence = evidenceInput(a.evidence);
      const receipt = buildEvidenceReceipt({
        workflow, summary, success, evidence: suppliedEvidence,
        finalCommit: finalRepository?.git.head?.sha,
      });
      const validation = validateEvidenceReceipt(receipt, { success, risk });
      // Backward compatibility: only workflows created with RASMIC metadata get the new
      // hard gate. Legacy in-flight workflows can still close under their old contract.
      if (workflow.orchestration && !validation.valid) throw new Error(validation.errors.join("; "));

      const finished = await finishWorkflow({
        actor, recipeActor: context.recipeActor ?? context.actor, workflowId, summary, success,
      });
      const automation = assessAutomationPromotion(finished.recipe);
      const persistenceWarnings: string[] = [];
      let evidencePath: string | undefined;
      let taskMemoryId: string | undefined;
      let scriptPath: string | undefined;
      const explicitEvidence = Boolean(suppliedEvidence && [
        suppliedEvidence.tests, suppliedEvidence.build, suppliedEvidence.deployment,
        suppliedEvidence.health, suppliedEvidence.artifacts, suppliedEvidence.manualVerification,
        suppliedEvidence.knownRisks,
      ].some((items) => Array.isArray(items) && items.length > 0));
      const shouldPersistEvidence = risk !== "low" || !success || explicitEvidence;
      const shouldPersistTaskMemory = shouldPersistEvidence || workflow.orchestration?.memoryRelevance !== "low";
      const memoryScope = [...new Set([
        ...(workflow.orchestration?.affectedPaths ?? []),
        ...(workflow.orchestration?.changedPaths ?? []),
      ])];

      if (project) {
        try {
          if (shouldPersistEvidence) evidencePath = await writeEvidenceReceipt(project.path, receipt);
          if (shouldPersistTaskMemory) {
            const taskMemory = await upsertRepoMemory(project.path, {
            kind: "task",
            title: `${success ? "Completed" : "Failed"}: ${workflow.intent.slice(0, 120)}`,
            summary,
            source: "system",
            result: success ? "pass" : "fail",
            status: success ? "confirmed" : "active",
            confidence: success ? 0.9 : 1,
            importance: risk === "high" ? 0.9 : risk === "medium" ? 0.7 : 0.5,
            lastVerified: success ? receipt.createdAt : undefined,
            scope: memoryScope,
            tags: ["workflow", risk, workflow.orchestration?.complexity ?? "unknown"],
            commit: receipt.finalCommit,
            environment: receipt.environment,
            happened: summary,
            ...(success ? { worked: summary } : { failed: summary }),
            learned: success ? "Result is backed by the attached Evidence Receipt." : "Do not treat this workflow as healthy until the failure is resolved and re-verified.",
            reuse: automation.stage === "verified" ? "A verified reusable recipe exists for similar work; prefer it before replanning from scratch." : "Retrieve this task memory when similar scope is attempted again.",
            });
            taskMemoryId = taskMemory.id;
          }
          if (!success) {
            await upsertRepoMemory(project.path, {
              kind: "failure", title: `Workflow failure: ${workflow.intent.slice(0, 120)}`, summary, source: "system",
              result: "fail", status: "active", confidence: 1, importance: 0.9,
              scope: memoryScope, tags: ["workflow-failure", risk], commit: receipt.finalCommit,
              failed: summary, reuse: "Check this failure before repeating the same approach.",
            });
          }
          if (automation.stage !== "observed") {
            await writePortableRecipe(project.path, {
              schemaVersion: 1, id: finished.recipe.id, intent: finished.recipe.intent, summary: finished.recipe.summary,
              stage: automation.stage, attempts: finished.recipe.attempts, successes: finished.recipe.successes, failures: finished.recipe.failures,
              successRate: automation.successRate, bestSteps: finished.recipe.bestSteps, quality: finished.recipe.quality, updatedAt: finished.recipe.updatedAt,
            }, finished.recipe.id);
          }
          if (automation.scriptCandidate) {
            const script = buildAutomationScriptManifest(finished.recipe, { tested: false });
            scriptPath = await writeAutomationScript(project.path, script, script.id, true);
          }
        } catch (error) {
          persistenceWarnings.push(error instanceof Error ? error.message : String(error));
        }
      }

      return {
        ...finished,
        evidence: { receipt, valid: validation.valid, errors: validation.errors, path: evidencePath },
        automation,
        metrics: {
          toolCalls: workflow.steps.length,
          executionDurationMs: finished.currentDurationMs,
          retries: finished.recipe.lastQuality?.retries ?? 0,
          memoryHits: workflow.orchestration?.memoryHits ?? 0,
          contextEstimateTokens: workflow.orchestration?.contextEstimateTokens ?? 0,
          recipeUsed: Boolean(workflow.orchestration?.recipeUsed),
          recipeStage: automation.stage,
          scriptCandidateCreated: Boolean(scriptPath),
        },
        repoMemory: { taskMemoryId, scriptPath, warnings: persistenceWarnings },
        cleanup: workflowCleanupGuidance(workflow.orchestration),
      };
    },
  },
];

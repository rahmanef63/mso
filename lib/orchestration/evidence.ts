import type { ActiveWorkflow } from "@/lib/skills/memory";
import { redactStrings, redactText } from "./redaction";
import type { EvidenceInput, EvidenceItem, EvidenceReceipt, RiskLevel } from "./types";

const passed = (values: unknown): EvidenceItem[] => redactStrings(values).map((name) => ({ name, status: "pass" as const }));

export function buildEvidenceReceipt(input: {
  workflow: ActiveWorkflow;
  summary: string;
  success: boolean;
  evidence?: EvidenceInput;
  finalCommit?: string;
  environment?: string;
}): EvidenceReceipt {
  const evidence = input.evidence ?? {};
  const orchestration = input.workflow.orchestration;
  const claims = redactStrings(evidence.claims);
  if (!claims.length) claims.push(redactText(input.summary, 1200) || (input.success ? "workflow completed" : "workflow failed"));
  return {
    schemaVersion: 1,
    workflow: input.workflow.id,
    ...(input.workflow.project ? { repo: redactText(input.workflow.project, 240) } : {}),
    ...(orchestration?.baseCommit ? { baseCommit: orchestration.baseCommit } : {}),
    ...(input.finalCommit ? { finalCommit: redactText(input.finalCommit, 80) } : {}),
    ...((evidence.environment || input.environment)
      ? { environment: redactText(evidence.environment || input.environment || "", 400) }
      : {}),
    claims,
    tests: passed(evidence.tests),
    build: passed(evidence.build),
    deployment: passed(evidence.deployment),
    health: passed(evidence.health),
    artifacts: redactStrings(evidence.artifacts),
    manualVerification: passed(evidence.manualVerification),
    knownRisks: redactStrings(evidence.knownRisks),
    createdAt: new Date().toISOString(),
  };
}

export function evidencePassCount(receipt: EvidenceReceipt): number {
  return [receipt.tests, receipt.build, receipt.deployment, receipt.health, receipt.manualVerification]
    .flat()
    .filter((item) => item.status === "pass").length;
}

export function validateEvidenceReceipt(receipt: EvidenceReceipt, options: {
  success: boolean;
  risk: RiskLevel;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!receipt.workflow) errors.push("workflow is required");
  if (!receipt.claims.length) errors.push("at least one claim is required");
  if (options.success && options.risk === "high" && evidencePassCount(receipt) < 1) {
    errors.push("a successful high-risk workflow requires explicit test/build/deployment/health/manual verification evidence");
  }
  return { valid: errors.length === 0, errors };
}

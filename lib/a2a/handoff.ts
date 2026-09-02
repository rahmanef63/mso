import type { A2ADiscoveredAgent } from "./types";
import { sendA2AMessage } from "./client";

export const MAX_A2A_HANDOFF_OBJECTIVE_BYTES = 8 * 1024;
export const MAX_A2A_HANDOFF_CONTEXT_BYTES = 8 * 1024;

function bounded(value: string, bytes: number, label: string): string {
  const out = String(value || "").trim();
  if (!out) throw new Error(`${label} must not be empty`);
  if (Buffer.byteLength(out, "utf8") > bytes) throw new Error(`${label} exceeds ${bytes} bytes`);
  return out;
}

export async function handoffA2A(
  agent: A2ADiscoveredAgent,
  objectiveRaw: string,
  suppliedContextRaw?: string,
  options: { returnImmediately?: boolean; sourceSessionHash?: string; sourceWorkflowHash?: string } = {},
): Promise<{ handoff: { objectiveBytes: number; contextBytes: number }; response: unknown }> {
  const objective = bounded(objectiveRaw, MAX_A2A_HANDOFF_OBJECTIVE_BYTES, "A2A handoff objective");
  const suppliedContext = suppliedContextRaw?.trim() ? bounded(suppliedContextRaw, MAX_A2A_HANDOFF_CONTEXT_BYTES, "A2A handoff context") : undefined;
  const message = `Objective:\n${objective}${suppliedContext ? `\n\nContext explicitly supplied by caller:\n${suppliedContext}` : ""}`;
  const response = await sendA2AMessage(agent, message, {
    returnImmediately: options.returnImmediately !== false,
    metadata: { "mso.a2a": { type: "handoff", source: "MSO", ...(options.sourceSessionHash ? { sourceSessionHash: options.sourceSessionHash } : {}), ...(options.sourceWorkflowHash ? { sourceWorkflowHash: options.sourceWorkflowHash } : {}) } },
  });
  return { handoff: { objectiveBytes: Buffer.byteLength(objective), contextBytes: Buffer.byteLength(suppliedContext || "") }, response };
}

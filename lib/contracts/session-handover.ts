/** Recommended explicit message payload, not a new MCP or A2A wire protocol. */
export const SESSION_HANDOVER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["version", "objective", "sourceSessionId", "project", "completed", "nextSteps", "evidence", "blockers", "constraints"],
  properties: {
    version: { const: 1 },
    objective: { type: "string", minLength: 1, maxLength: 2000 },
    sourceSessionId: { type: "string", pattern: "^\\d{8}_\\d{6}_[a-f0-9]{8}$" },
    project: { type: "object", additionalProperties: false, required: ["path", "branch"],
      properties: { path: { type: "string", maxLength: 500 }, branch: { type: "string", maxLength: 200 } } },
    completed: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
    nextSteps: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", maxLength: 500 } },
    evidence: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
    blockers: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
    constraints: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
  },
} as const;
export function handoverExample(sourceSessionId = "20260909_120000_1234abcd") {
  return { version: 1, objective: "Continue the reviewed task",
    sourceSessionId, project: { path: "/path/to/project", branch: "feat/task" },
    completed: ["Describe the completed change"], nextSteps: ["Run the remaining verification"],
    evidence: ["Commit SHA and exact test result"], blockers: [],
    constraints: ["Preserve other sessions' work", "Ask before an irreversible action"] };
}
export function handoverRequestExample(sourceSessionId?: string) {
  return { target: "EXACT_TARGET_SESSION_ID", kind: "task", intent: "request", requires_user_relay: true,
    message: JSON.stringify(handoverExample(sourceSessionId)) };
}

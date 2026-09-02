import type { Scope } from "@/lib/mcp/scope";

export type A2ATaskState =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_AUTH_REQUIRED";

export type A2AMessage = {
  messageId: string;
  role: "ROLE_USER" | "ROLE_AGENT";
  parts: Array<{ text: string; mediaType: "text/plain" }>;
  contextId?: string;
  taskId?: string;
};

export type A2ATaskRecord = {
  id: string;
  contextId: string;
  principal: string;
  scope: Scope;
  targetSessionId?: string;
  status: { state: A2ATaskState; timestamp: string; message?: A2AMessage };
  history: A2AMessage[];
  artifacts: Array<{
    artifactId: string;
    name: string;
    parts: Array<{ text: string; mediaType: "text/plain" }>;
  }>;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

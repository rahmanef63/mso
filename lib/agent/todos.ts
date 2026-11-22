import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { sessionLockTarget, writeSessionFile } from "./session-files";
import { requireOwned } from "./session-record";
import { appendAgentSessionEvent } from "./session-mutations";
import { getAgentSession } from "./session-store";
import type { AgentSession } from "./session-types";

export type AgentTodoStatus = "pending" | "in_progress" | "completed";

export interface AgentTodoItem {
  content: string;
  status: AgentTodoStatus;
  activeForm?: string;
}

export type AgentSessionWithTodos = AgentSession & {
  todos?: AgentTodoItem[];
};

export interface AgentTodoSummary {
  ok: true;
  count: number;
  inProgress: string | null;
  completed: number;
  pending: number;
}

export const MAX_TODO_ITEMS = 50;
export const MAX_TODO_CONTENT_LENGTH = 200;
export const VALID_TODO_STATUSES: readonly AgentTodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
] as const;

export function isValidTodoStatus(value: unknown): value is AgentTodoStatus {
  return typeof value === "string" && VALID_TODO_STATUSES.includes(value as AgentTodoStatus);
}

export function validateTodoItem(item: unknown, index?: number): AgentTodoItem {
  const prefix = index !== undefined ? `todo item at index ${index}` : "todo item";
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${prefix} must be an object`);
  }
  const raw = item as Record<string, unknown>;

  if (typeof raw.content !== "string") {
    throw new Error(`${prefix} content must be a string`);
  }
  const content = raw.content.trim();
  if (content.length === 0) {
    throw new Error(`${prefix} content cannot be empty`);
  }
  if (content.length > MAX_TODO_CONTENT_LENGTH) {
    throw new Error(
      `${prefix} content exceeds maximum length of ${MAX_TODO_CONTENT_LENGTH} characters`,
    );
  }

  if (!isValidTodoStatus(raw.status)) {
    throw new Error(
      `${prefix} status must be one of: ${VALID_TODO_STATUSES.join(", ")}`,
    );
  }

  const result: AgentTodoItem = {
    content,
    status: raw.status,
  };

  if (raw.activeForm !== undefined) {
    if (typeof raw.activeForm !== "string") {
      throw new Error(`${prefix} activeForm must be a string if provided`);
    }
    result.activeForm = raw.activeForm;
  }

  return result;
}

export function validateTodoList(input: unknown): AgentTodoItem[] {
  if (!Array.isArray(input)) {
    throw new Error("todos must be an array");
  }
  if (input.length > MAX_TODO_ITEMS) {
    throw new Error(
      `todos list cannot exceed ${MAX_TODO_ITEMS} items (received ${input.length})`,
    );
  }
  return input.map((item, index) => validateTodoItem(item, index));
}

export function summarizeTodos(
  todos: readonly AgentTodoItem[],
): Omit<AgentTodoSummary, "ok"> {
  let completed = 0;
  let pending = 0;
  let singleInProgress: string | null = null;
  let inProgressCount = 0;

  for (const item of todos) {
    if (item.status === "completed") {
      completed += 1;
    } else if (item.status === "pending") {
      pending += 1;
    } else if (item.status === "in_progress") {
      inProgressCount += 1;
      if (inProgressCount === 1) {
        singleInProgress = item.content;
      }
    }
  }

  return {
    count: todos.length,
    inProgress: singleInProgress,
    completed,
    pending,
  };
}

export function formatTodoNoteDetail(
  summary: Omit<AgentTodoSummary, "ok">,
): string {
  if (summary.inProgress) {
    return `Todos: ${summary.count} items (${summary.completed} completed, in progress: ${summary.inProgress})`;
  }
  return `Todos: ${summary.count} items (${summary.completed} completed, none in progress)`;
}

export async function writeAgentSessionTodos(
  principal: string,
  id: string,
  rawTodos: unknown,
): Promise<AgentTodoSummary> {
  const validated = validateTodoList(rawTodos);
  const summary = summarizeTodos(validated);

  await withSecurityStoreLock(sessionLockTarget(id), async () => {
    const record = (await requireOwned(principal, id)) as AgentSessionWithTodos;
    record.todos = validated;
    record.updatedAt = new Date().toISOString();
    await writeSessionFile(record);
  });

  const detail = formatTodoNoteDetail(summary);
  await appendAgentSessionEvent(principal, id, {
    kind: "note",
    detail,
  });

  return {
    ok: true,
    ...summary,
  };
}

export async function readAgentSessionTodos(
  principal: string,
  id: string,
): Promise<AgentTodoItem[]> {
  const record = (await getAgentSession(principal, id)) as AgentSessionWithTodos | null;
  if (!record) {
    throw new Error("agent session not found for this client");
  }
  return record.todos ? [...record.todos] : [];
}

export const getAgentSessionTodos = readAgentSessionTodos;

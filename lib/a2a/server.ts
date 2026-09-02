import { audit, rateLimited } from "@/lib/host";
import { clientIp } from "@/lib/mcp/origin";
import { resolveAgentSessionOwnerRef } from "@/lib/agent/session-query";
import type { AgentSession } from "@/lib/agent/session-types";
import { a2aInboundOriginForRequest } from "./inbound-config";
import {
  cancelA2AActiveTask,
  createA2ATask,
  getA2ATaskForPrincipal,
  listA2ATaskRecordsForPrincipal,
  taskPublicView,
} from "./tasks";
import { a2aSseResponse, executeInboundA2ATask } from "./server-execution";
import { listInboundA2ATasks } from "./server-list";
import {
  A2A_TERMINAL_STATES,
  a2aJson,
  a2aObject,
  a2aRpcError,
  a2aRpcOk,
  a2aTaskError,
  a2aUnauthorized,
  authenticateA2ARequest,
  parseA2ATextMessage,
  readA2ARpcBody,
  type A2ARpcBody,
} from "./server-protocol";

export async function handleA2ARequest(req: Request): Promise<Response> {
  if (!a2aInboundOriginForRequest(req.url))
    return a2aJson({ error: "not_found" }, 404);
  if (req.method !== "POST")
    return a2aJson({ error: "method_not_allowed" }, 405, { allow: "POST" });
  if (rateLimited(`a2a.inbound.ip:${clientIp(req)}`, 120, 60_000))
    return a2aJson({ error: "rate_limited" }, 429, { "retry-after": "60" });
  const profile = await authenticateA2ARequest(req);
  if (!profile) return a2aUnauthorized();
  if (rateLimited(`a2a.inbound.token:${profile.id}`, 60, 60_000))
    return a2aJson({ error: "rate_limited" }, 429, { "retry-after": "60" });

  const requestUrl = new URL(req.url);
  const sessionRef = requestUrl.searchParams.get("session")?.trim() || "";
  let targetSession: AgentSession | undefined;
  if (sessionRef) {
    if (!profile.local) return a2aUnauthorized();
    try {
      targetSession = await resolveAgentSessionOwnerRef(sessionRef);
    } catch {
      return a2aJson({ error: "session_not_found" }, 404);
    }
  }
  const principal = targetSession
    ? `a2a:local:${targetSession.id}`
    : `a2a:${profile.id}`;
  let body: A2ARpcBody;
  try {
    body = await readA2ARpcBody(req);
  } catch (error) {
    return a2aJson(
      a2aRpcError(
        null,
        -32700,
        error instanceof Error && error.message === "request_too_large"
          ? "Request too large"
          : "Parse error",
      ),
    );
  }
  const id = body.id ?? null;
  const method = String(body.method || "");
  const params = a2aObject(body.params);
  if (body.jsonrpc !== "2.0" || !method)
    return a2aJson(a2aRpcError(id, -32600, "Invalid Request"));

  try {
    if (method === "SendMessage" || method === "SendStreamingMessage") {
      const parsed = parseA2ATextMessage(params);
      const task = await createA2ATask(
        principal,
        profile.scope,
        parsed.message,
        targetSession?.id,
      );
      if (method === "SendStreamingMessage")
        return a2aSseResponse(id, task, profile, parsed.prompt, targetSession);
      if (parsed.returnImmediately) {
        void executeInboundA2ATask(task, profile, parsed.prompt, targetSession);
        return a2aJson(a2aRpcOk(id, { task: taskPublicView(task) }));
      }
      const completed = await executeInboundA2ATask(
        task,
        profile,
        parsed.prompt,
        targetSession,
      );
      return a2aJson(a2aRpcOk(id, { task: taskPublicView(completed) }));
    }
    if (method === "GetTask") {
      const taskId = String(params.id || "").trim();
      if (!taskId) return a2aJson(a2aRpcError(id, -32602, "Invalid params"));
      const historyLength = Math.max(
        0,
        Math.min(100, Math.trunc(Number(params.historyLength)) || 10),
      );
      const task = await getA2ATaskForPrincipal(
        taskId,
        principal,
        historyLength,
      );
      return task
        ? a2aJson(a2aRpcOk(id, task))
        : a2aJson(a2aRpcError(id, -32001, "Task not found"));
    }
    if (method === "ListTasks")
      return a2aJson(
        a2aRpcOk(id, await listInboundA2ATasks(principal, params)),
      );
    if (method === "CancelTask") {
      const taskId = String(params.id || "").trim();
      if (!taskId) return a2aJson(a2aRpcError(id, -32602, "Invalid params"));
      const existing = await getA2ATaskForPrincipal(taskId, principal, 10);
      if (!existing) return a2aJson(a2aRpcError(id, -32001, "Task not found"));
      if (A2A_TERMINAL_STATES.has(String(existing.status.state)))
        return a2aJson(a2aRpcError(id, -32002, "Task not cancelable"));
      const task = await cancelA2AActiveTask(taskId, principal);
      void audit({
        action: "a2a.task",
        actor: principal,
        target: taskId,
        detail: "cancel",
      });
      return a2aJson(a2aRpcOk(id, task));
    }
    if (method === "SubscribeToTask") {
      const taskId = String(params.id || "").trim();
      if (!taskId) return a2aJson(a2aRpcError(id, -32602, "Invalid params"));
      const existing = await getA2ATaskForPrincipal(taskId, principal, 10);
      if (!existing) return a2aJson(a2aRpcError(id, -32001, "Task not found"));
      if (A2A_TERMINAL_STATES.has(String(existing.status.state)))
        return a2aJson(a2aRpcError(id, -32004, "Unsupported operation"));
      const full = (await listA2ATaskRecordsForPrincipal(principal)).find(
        (row) => row.id === taskId,
      );
      return full
        ? a2aSseResponse(id, full, profile, undefined, targetSession)
        : a2aJson(a2aRpcError(id, -32001, "Task not found"));
    }
    return a2aJson(a2aRpcError(id, -32601, "Method not found"));
  } catch (error) {
    return a2aJson(a2aTaskError(id, error));
  }
}

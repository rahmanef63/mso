import { randomUUID } from "node:crypto";
import type { A2ADiscoveredAgent, A2ASendOptions } from "./types";
import {
  a2aAuthorizationHeaders,
  a2aHeaders,
  a2aObject,
  a2aRequestParams,
  a2aRestOperationUrl,
  a2aTransport,
  assertA2AMessage,
  fetchA2AJson,
  normalizeA2ABinding,
  type A2AFetchLike,
} from "./client-core";

export function a2aSendParams(
  target: A2ADiscoveredAgent,
  message: string,
  options: A2ASendOptions = {},
): Record<string, unknown> {
  const content = assertA2AMessage(message);
  const msg = {
    messageId: randomUUID(),
    role: "ROLE_USER",
    parts: [{ text: content, mediaType: "text/plain" }],
    ...(options.contextId ? { contextId: options.contextId } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
  };
  const configuration = {
    acceptedOutputModes: target.card.defaultOutputModes.length
      ? target.card.defaultOutputModes.slice(0, 20)
      : ["text/plain", "application/json"],
    ...(options.historyLength !== undefined
      ? {
          historyLength: Math.max(
            0,
            Math.min(100, Math.trunc(options.historyLength)),
          ),
        }
      : {}),
    ...(options.returnImmediately !== undefined
      ? { returnImmediately: options.returnImmediately }
      : {}),
  };
  return {
    message: msg,
    configuration,
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

async function invokeA2A(
  target: A2ADiscoveredAgent,
  method: "SendMessage" | "GetTask" | "CancelTask",
  params: Record<string, unknown>,
  fetchImpl: A2AFetchLike,
): Promise<unknown> {
  const auth = await a2aAuthorizationHeaders(target);
  const iface = target.selectedInterface;
  const binding = normalizeA2ABinding(iface.protocolBinding);
  if (!binding)
    throw new Error(`unsupported A2A binding: ${iface.protocolBinding}`);
  const rpcParams = a2aRequestParams(iface, params);
  if (binding === "JSONRPC") {
    const rpcId = randomUUID();
    const response = a2aObject(
      await fetchA2AJson(
        iface.url,
        {
          method: "POST",
          headers: a2aHeaders(iface, "application/json", auth),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: rpcId,
            method,
            params: rpcParams,
          }),
        },
        fetchImpl,
      ),
    );
    if (response.error) {
      const error = a2aObject(response.error);
      throw new Error(
        `A2A ${method} failed: ${String(error.message || "JSON-RPC error")}`,
      );
    }
    return response.result;
  }
  if (method === "GetTask") {
    const taskId = encodeURIComponent(String(params.id));
    const url = new URL(a2aRestOperationUrl(iface, `tasks/${taskId}`));
    if (iface.tenant) url.searchParams.set("tenant", iface.tenant);
    if (params.historyLength !== undefined)
      url.searchParams.set("historyLength", String(params.historyLength));
    return fetchA2AJson(
      url.toString(),
      { headers: a2aHeaders(iface, "application/a2a+json", auth) },
      fetchImpl,
    );
  }
  const route =
    method === "SendMessage"
      ? "message:send"
      : `tasks/${encodeURIComponent(String(params.id))}:cancel`;
  const body =
    method === "SendMessage"
      ? a2aRequestParams(iface, params)
      : { ...(iface.tenant ? { tenant: iface.tenant } : {}) };
  return fetchA2AJson(
    a2aRestOperationUrl(iface, route),
    {
      method: "POST",
      headers: a2aHeaders(iface, "application/a2a+json", auth),
      body: JSON.stringify(body),
    },
    fetchImpl,
  );
}

export async function sendA2AMessage(
  target: A2ADiscoveredAgent,
  message: string,
  options: A2ASendOptions = {},
  fetchImpl: A2AFetchLike = a2aTransport,
): Promise<unknown> {
  return invokeA2A(
    target,
    "SendMessage",
    a2aSendParams(target, message, options),
    fetchImpl,
  );
}

export function getA2ATask(
  target: A2ADiscoveredAgent,
  taskId: string,
  historyLength = 10,
  fetchImpl: A2AFetchLike = a2aTransport,
): Promise<unknown> {
  const id = String(taskId || "").trim();
  if (!id) throw new Error("A2A task id is required");
  return invokeA2A(
    target,
    "GetTask",
    {
      id,
      historyLength: Math.max(0, Math.min(100, Math.trunc(historyLength))),
    },
    fetchImpl,
  );
}

export function cancelA2ATask(
  target: A2ADiscoveredAgent,
  taskId: string,
  fetchImpl: A2AFetchLike = a2aTransport,
): Promise<unknown> {
  const id = String(taskId || "").trim();
  if (!id) throw new Error("A2A task id is required");
  return invokeA2A(target, "CancelTask", { id }, fetchImpl);
}

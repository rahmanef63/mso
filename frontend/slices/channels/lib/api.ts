import type { ChannelsSnapshot, WorkflowOption } from "../types";

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `request failed (${response.status})`);
  return body as T;
}

export const loadChannels = () => json<ChannelsSnapshot>("/api/v1/channels");
export const channelAction = (body: Record<string, unknown>) =>
  json<unknown>("/api/v1/channels", { method: "POST", body: JSON.stringify(body) });

export async function loadChannelWorkflows() {
  const graphs = (await json<{ graphs: WorkflowOption[] }>("/api/v1/workflows")).graphs;
  return graphs.filter((graph) =>
    graph.status === "active" && graph.nodes.some((node) => node.type === "channel_trigger")
  );
}

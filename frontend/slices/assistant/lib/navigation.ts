export type AssistantTab = "chat" | "agents" | "skills" | "automations" | "mcp";

const TABS = new Set<AssistantTab>(["chat", "agents", "skills", "automations", "mcp"]);

export function assistantRouteFromPayload(payload: unknown): { key: string; tab: AssistantTab } {
  if (!payload || typeof payload !== "object") return { key: "", tab: "chat" };
  const path = (payload as { path?: unknown }).path;
  if (typeof path !== "string") return { key: "", tab: "chat" };
  const normalized = "/" + path.split("/").filter(Boolean).join("/");
  const segment = normalized.split("/").filter(Boolean)[0] as AssistantTab | undefined;
  return { key: normalized, tab: segment && TABS.has(segment) ? segment : "chat" };
}

export function assistantTabFromPayload(payload: unknown): AssistantTab {
  return assistantRouteFromPayload(payload).tab;
}

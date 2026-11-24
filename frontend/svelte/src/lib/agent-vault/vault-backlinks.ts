import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import type { AgentVaultNote } from "./agent-vault-api.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Backlinks reuse the bounded memory-graph projection (single request, no graph renderer).
 * Any failure degrades to "no backlinks" instead of blocking the reader.
 */
export async function readVaultBacklinks(
  root: string, project: string, notes: AgentVaultNote[], selectedPath: string, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentVaultNote[]> {
  const directory = root.trim().replace(/\/+$/, "");
  const target = selectedPath.trim();
  if (!directory || !target) return [];
  const params = new URLSearchParams({ root: directory });
  if (project.trim()) params.set("project", project.trim());
  const response = await fetcher(resolveApiUrl(`/api/v1/memory-graph?${params.toString()}`, bridge), {
    method: "GET",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return [];
  if (!(response.headers.get("content-type")?.includes("application/json") ?? false)) return [];
  let payload: unknown;
  try { payload = await response.json(); } catch { return []; }
  if (!isRecord(payload) || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) return [];

  const pathById = new Map<string, string>();
  let targetId: string | null = null;
  for (const node of payload.nodes) {
    if (!isRecord(node) || typeof node.id !== "string" || typeof node.path !== "string") continue;
    pathById.set(node.id, node.path);
    if (node.path === `${directory}/${target}`) targetId = node.id;
  }
  if (!targetId) return [];

  const sourceIds = new Set<string>();
  for (const edge of payload.edges) {
    if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") continue;
    if (edge.resolved !== true) continue;
    if (edge.target === targetId) sourceIds.add(edge.source);
  }
  const linked = new Set<string>();
  for (const id of sourceIds) {
    const path = pathById.get(id);
    if (path && path.startsWith(`${directory}/`)) linked.add(path.slice(directory.length + 1));
  }
  return notes.filter((note) => linked.has(note.path));
}

import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type MemoryNodeKind = "note" | "ghost" | "knowledge" | "memory" | "agent" | "folder" | "tag";
export type MemoryEdgeKind = "wikilink" | "mention" | "contains" | "related" | "tag";
export type MemoryNodeTargetApp = "workflows" | "organization";

export type MemoryGraphNode = {
  id: string;
  title: string;
  kind: MemoryNodeKind;
  group: string;
  degree: number;
  path?: string;
  excerpt?: string;
  targetApp?: MemoryNodeTargetApp;
  origin?: string;
};

export type MemoryGraphEdge = {
  source: string;
  target: string;
  kind: MemoryEdgeKind;
  resolved: boolean;
};

export type MemoryGraphCounts = {
  notes: number;
  memories: number;
  ghosts: number;
};

export type MemoryGraphDocument = {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  truncated: boolean;
  warnings: string[];
  root: string | null;
  counts: MemoryGraphCounts;
};

export type MemoryGraphState =
  | { kind: "loading" }
  | { kind: "ready"; graph: MemoryGraphDocument }
  | { kind: "error"; message: string; forbidden?: boolean };

const NODE_KINDS = new Set<MemoryNodeKind>(["note", "ghost", "knowledge", "memory", "agent", "folder", "tag"]);
const EDGE_KINDS = new Set<MemoryEdgeKind>(["wikilink", "mention", "contains", "related", "tag"]);
const TARGET_APPS = new Set<MemoryNodeTargetApp>(["workflows", "organization"]);

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
const invalid = () => new ApiError("The MSO memory graph response is invalid.", 502);

function statusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "Owner role is required to view the memory graph.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return "Memory graph service is temporarily unavailable. Retry when ready.";
  return `Memory graph request failed (${status}).`;
}

function validateNode(raw: unknown): MemoryGraphNode {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.title)
      || !NODE_KINDS.has(raw.kind as MemoryNodeKind)
      || typeof raw.group !== "string"
      || !isNonNegInt(raw.degree)
      || !isOptStr(raw.path) || !isOptStr(raw.excerpt) || !isOptStr(raw.origin)
      || (raw.targetApp !== undefined && !TARGET_APPS.has(raw.targetApp as MemoryNodeTargetApp))) {
    throw invalid();
  }
  return {
    id: raw.id,
    title: raw.title,
    kind: raw.kind as MemoryNodeKind,
    group: raw.group,
    degree: raw.degree,
    ...(raw.path ? { path: raw.path } : {}),
    ...(raw.excerpt ? { excerpt: raw.excerpt } : {}),
    ...(raw.targetApp ? { targetApp: raw.targetApp as MemoryNodeTargetApp } : {}),
    ...(raw.origin ? { origin: raw.origin } : {}),
  };
}

function validateEdge(raw: unknown): MemoryGraphEdge {
  if (!isRecord(raw) || !isNonEmpty(raw.source) || !isNonEmpty(raw.target)
      || !EDGE_KINDS.has(raw.kind as MemoryEdgeKind)
      || typeof raw.resolved !== "boolean") {
    throw invalid();
  }
  return {
    source: raw.source,
    target: raw.target,
    kind: raw.kind as MemoryEdgeKind,
    resolved: raw.resolved,
  };
}

function validateDocument(payload: unknown): MemoryGraphDocument {
  if (!isRecord(payload) || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)
      || typeof payload.truncated !== "boolean"
      || !Array.isArray(payload.warnings) || !payload.warnings.every((w) => typeof w === "string")
      || (payload.root !== null && typeof payload.root !== "string")
      || !isRecord(payload.counts)
      || !isNonNegInt(payload.counts.notes)
      || !isNonNegInt(payload.counts.memories)
      || !isNonNegInt(payload.counts.ghosts)) {
    throw invalid();
  }
  return {
    nodes: payload.nodes.map(validateNode),
    edges: payload.edges.map(validateEdge),
    truncated: payload.truncated,
    warnings: payload.warnings.map((w) => w.trim()).filter(Boolean),
    root: payload.root,
    counts: {
      notes: payload.counts.notes,
      memories: payload.counts.memories,
      ghosts: payload.counts.ghosts,
    },
  };
}

export async function readMemoryGraph(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryGraphDocument> {
  const response = await fetcher(resolveApiUrl("/api/v1/memory-graph", bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw invalid(); }
  return validateDocument(payload);
}

export function createMemoryGraphController(
  update: (next: MemoryGraphState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const graph = await readMemoryGraph(controller.signal, fetcher, bridge);
        if (!disposed && run === generation) update({ kind: "ready", graph });
      } catch (error) {
        if (!disposed && run === generation && !controller.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({
            kind: "error",
            message: error instanceof ApiError ? error.message : "Could not load memory graph. Check the backend and retry.",
            ...(forbidden ? { forbidden: true } : {}),
          });
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

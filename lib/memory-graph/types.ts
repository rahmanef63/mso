// Memory-graph contract shared by the owner API and the Memory app.
// Node/edge ideas (ghosts, wikilinks, groups) follow rahmanef63/open-silong
// frontend/slices/memory-graph (MIT). This file is an MSO-native shape.

export type MemoryNodeKind = "note" | "ghost" | "knowledge" | "memory" | "agent" | "folder" | "tag";
export type MemoryEdgeKind = "wikilink" | "mention" | "contains" | "related" | "tag";

export interface MemoryGraphNode {
  id: string;
  title: string;
  kind: MemoryNodeKind;
  /** Color/group key: vault folder, project, or memory bucket. */
  group: string;
  degree: number;
  /** Host path the Code app can open. Absent for ghosts and private claims. */
  path?: string;
  excerpt?: string;
  targetApp?: "workflows" | "organization";
  origin?: string;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  kind: MemoryEdgeKind;
  resolved: boolean;
}

export interface MemoryGraphDocument {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  truncated: boolean;
  warnings: string[];
  /** Resolved vault root, when a readable vault was scanned. */
  root: string | null;
  counts: { notes: number; memories: number; ghosts: number };
}

export interface GraphInputNode {
  id: string;
  title: string;
  kind: Exclude<MemoryNodeKind, "ghost" | "tag">;
  group: string;
  path?: string;
  excerpt?: string;
  targetApp?: "workflows" | "organization";
  origin?: string;
  /** Link source only. Never copied onto the returned node. */
  text?: string;
}

export interface GraphInputLink {
  source: string;
  targetId?: string;
  /** Wikilink title or relative markdown href. */
  target?: string;
  kind: Exclude<MemoryEdgeKind, "tag">;
}

export type AgentMemoryDocument = "USER.md" | "MEMORY.md";
export type AgentMemoryKind = "semantic" | "episodic" | "procedural";
export type AgentMemorySensitivity = "normal" | "private" | "restricted";
export type AgentMemoryAuthority = "explicit" | "observed" | "inferred" | "migration";
export type AgentMemoryChannel = "mcp" | "cli" | "alfa" | "system" | "legacy";

export interface AgentMemoryProvenance {
  authority: AgentMemoryAuthority;
  channel: AgentMemoryChannel;
  observedAt: string;
  sessionHash?: string;
}

export interface AgentMemoryRecord {
  id: string;
  document: AgentMemoryDocument;
  key: string;
  value: string;
  kind: AgentMemoryKind;
  confidence: number;
  sensitivity: AgentMemorySensitivity;
  validFrom: string;
  validUntil?: string;
  createdAt: string;
  provenance: AgentMemoryProvenance;
  supersedes?: string[];
  supersededAt?: string;
  supersededBy?: string;
  retractedAt?: string;
}

export interface AgentMemoryLedger {
  schemaVersion: 1;
  updatedAt: string;
  records: AgentMemoryRecord[];
}

export interface AgentMemoryWriteOptions {
  kind?: AgentMemoryKind;
  confidence?: number;
  sensitivity?: AgentMemorySensitivity;
  validFrom?: string;
  validUntil?: string;
  mode?: "replace" | "claim";
  provenance?: Partial<AgentMemoryProvenance>;
}

export interface AgentMemoryQuery {
  query?: string;
  document?: AgentMemoryDocument;
  kind?: AgentMemoryKind;
  at?: string;
  limit?: number;
  includeHistory?: boolean;
}

export interface AgentMemoryResolvedRecord {
  record: AgentMemoryRecord;
  conflicts: AgentMemoryRecord[];
}

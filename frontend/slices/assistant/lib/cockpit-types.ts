export type CockpitProjectRow = {
  id: string;
  name: string;
  path: string;
  packageName?: string;
  packageVersion?: string;
  git?: { branch?: string; head?: string };
};

export type CockpitSelectedProject = {
  project: { id: string; name: string; path: string; rootId: string };
  git: {
    available?: boolean;
    branch?: string;
    clean?: boolean;
    changes?: string[];
    head?: { sha?: string; subject?: string; date?: string; author?: string };
  };
  package?: { name?: string; version?: string };
  capabilities?: Record<string, unknown>;
  database?: { detected?: boolean; configured?: boolean; mode?: string };
  integrations?: { projectMcp?: Array<{ name?: string; description?: string }> };
  knowledge?: { exists?: boolean; bytes?: number; sha256?: string };
  recentMemory?: Array<{
    id: string;
    kind: string;
    status: string;
    title: string;
    updatedAt: string;
    score: number;
  }>;
};

export type AlfaCockpitData = {
  model: { provider: string; model: string; tokenSaver: string };
  projects: {
    total: number;
    hasMore: boolean;
    scan: { truncated?: boolean; truncationReasons?: string[] };
    rows: CockpitProjectRow[];
  };
  selectedProject: CockpitSelectedProject | null;
  sessions: Array<{
    id: string;
    name: string;
    source: string;
    title: string;
    updatedAt: string;
    cwd?: string;
    estimatedTokens: number;
    eventCount: number;
  }>;
  localAgents: Array<{
    id: string;
    name: string;
    label: string;
    status: string;
    title: string;
    cwd?: string;
    lastSeenAt: string;
  }>;
  legacyMemoryCount: number;
  typedMemory: {
    telemetry: {
      liveRecords: number;
      archivedRecords: number;
      totalRecords: number;
      resolvedKeys: number;
      conflictKeys: number;
      futureScheduled: number;
      archiveSegments: number;
    };
    records: Array<{
      id: string;
      document: string;
      key: string;
      value: string;
      kind: string;
      confidence: number;
      sensitivity: string;
      authority: string;
      observedAt: string;
      conflictCount: number;
    }>;
  };
};

export type HostSkillRow = {
  id: string;
  name: string;
  description: string;
  source: string;
  trust: string;
  project?: { id?: string; name?: string; path?: string };
};

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/memory-store", () => ({ queryAgentMemory: vi.fn() }));
vi.mock("@/lib/agent/legacy-owner-memory", () => ({ listMemories: vi.fn() }));
vi.mock("@/lib/host/projects-api", () => ({
  listProjects: vi.fn(),
  resolveProjectHint: vi.fn(),
  readProjectKnowledge: vi.fn(),
}));
vi.mock("@/lib/orchestration/repo-memory", () => ({ listRepoMemoryRecords: vi.fn() }));

import { queryAgentMemory } from "@/lib/agent/memory-store";
import { listMemories } from "@/lib/agent/legacy-owner-memory";
import { readProjectKnowledge, resolveProjectHint } from "@/lib/host/projects-api";
import { listRepoMemoryRecords } from "@/lib/orchestration/repo-memory";
import { collectMemoryGraph } from "./collect";

const agent = vi.mocked(queryAgentMemory);
const memories = vi.mocked(listMemories);
const knowledge = vi.mocked(readProjectKnowledge);
const project = vi.mocked(resolveProjectHint);
const records = vi.mocked(listRepoMemoryRecords);

describe("collectMemoryGraph", () => {
  beforeEach(() => {
    agent.mockReset();
    memories.mockReset();
    knowledge.mockReset();
    project.mockReset();
    records.mockReset();
  });

  it("joins a vault note, project knowledge, and redacts private agent memory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mso-memory-collect-"));
    vi.stubEnv("OS_FS_READ_ROOTS", root);
    await mkdir(path.join(root, "daily"), { recursive: true });
    await writeFile(path.join(root, "daily", "Alpha.md"), "# Alpha\n\nHello vault\n");
    project.mockResolvedValue({
      hint: "demo", id: "root/demo", name: "demo", path: "/projects/demo", rootId: "root", root: "/projects", aliases: [], matchedBy: "name",
    });
    knowledge.mockResolvedValue({ exists: true, path: ".mso/KNOWLEDGE.md", content: "Use [[Alpha]]\napi_key=super-secret", bytes: 10, sha256: "abc" });
    records.mockResolvedValue([{
      schemaVersion: 1, id: "rec_1", kind: "decision", status: "active", title: "Ship graph", summary: "See [[Alpha]]",
      source: "agent", confidence: 0.9, importance: 0.5, scope: [], tags: [], supersedes: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    }]);
    agent.mockResolvedValue({
      at: "2026-09-01T00:00:00.000Z", schemaVersion: 1, total: 1, records: [{
        record: {
          id: "mem_1", document: "MEMORY.md", key: "Token", value: "sk_live_should_not_leak", kind: "semantic",
          confidence: 1, sensitivity: "private", validFrom: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z",
          provenance: { authority: "explicit", channel: "cli", observedAt: "2026-09-01T00:00:00.000Z" },
        },
        conflicts: [],
      }],
    });
    memories.mockResolvedValue([]);

    const graph = await collectMemoryGraph({ root, project: "demo", principal: "cli:device" });
    const encoded = JSON.stringify(graph);
    expect(encoded).not.toContain("super-secret");
    expect(encoded).not.toContain("sk_live_should_not_leak");
    expect(graph.nodes.some((node) => node.kind === "note" && node.title === "Alpha")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "wikilink" && edge.target.startsWith("note:"))).toBe(true);
    expect(graph.nodes.find((node) => node.id === "agent:mem_1")?.excerpt).toBe("Private memory");
  });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listWorkflowGraphVersions, readWorkflowGraphVersion, saveWorkflowGraphVersion } from "./graph-version-store";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-version-security-")); roots.push(root);
  vi.stubEnv("OS_AGENT_SESSIONS_DIR", root);
  const owner = "a".repeat(64), revision = "b".repeat(64), graphId = "fixture";
  const dir = path.join(root, ".workflow-graph-versions", owner, graphId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return { root, owner, revision, graphId, dir };
}
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
it("uses an anchored snapshot filename rather than accepting an arbitrary suffix", async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.dir, `unexpected-${f.revision}.json`), "{}", { mode: 0o600 });
  expect(await readWorkflowGraphVersion(f.owner, f.graphId, f.revision)).toBeNull();
  expect(await listWorkflowGraphVersions(f.owner, f.graphId)).toEqual([]);
});
it("refuses symlink snapshots in both the history list and exact revision reads", async () => {
  const f = await fixture(), outside = path.join(f.root, "outside.json");
  await fs.writeFile(outside, "{}", { mode: 0o600 });
  await fs.symlink(outside, path.join(f.dir, `1-${f.revision}.json`));
  await expect(readWorkflowGraphVersion(f.owner, f.graphId, f.revision)).rejects.toThrow();
  await expect(listWorkflowGraphVersions(f.owner, f.graphId)).rejects.toThrow();
});
it("rejects oversized listing snapshots and mismatched graph identity", async () => {
  const f = await fixture(), file = path.join(f.dir, `1-${f.revision}.json`);
  await fs.writeFile(file, " ".repeat(321 * 1024), { mode: 0o600 });
  await expect(listWorkflowGraphVersions(f.owner, f.graphId)).rejects.toThrow("unsafe workflow version snapshot");
  await fs.writeFile(file, JSON.stringify({ revision: f.revision, savedAt: new Date(1).toISOString(), reason: "create", graph: { id: "another", revision: f.revision, name: "Other", nodes: [] } }));
  await expect(readWorkflowGraphVersion(f.owner, f.graphId, f.revision)).rejects.toThrow("invalid workflow version snapshot");
});
it("rejects an invalid revision before creating a version file", async () => {
  const f = await fixture();
  const graph = { id: f.graphId, revision: "../../escape" } as WorkflowGraph;
  await expect(saveWorkflowGraphVersion(f.owner, graph, "create")).rejects.toThrow("invalid workflow revision");
  expect(await fs.readdir(f.dir)).toEqual([]);
});

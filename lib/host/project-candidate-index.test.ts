import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-candidate-index-"));
const cache = path.join(root, "cache");
process.env.MSO_CANDIDATE_INDEX_DIR = cache;
const { searchProjectCandidateIndex } = await import("./project-candidate-index");

async function resetProject() {
  const project = path.join(root, "project");
  await fs.rm(project, { recursive: true, force: true });
  await fs.mkdir(path.join(project, "lib", "workflow"), { recursive: true });
  await fs.mkdir(path.join(project, "skills", "deploy"), { recursive: true });
  await fs.mkdir(path.join(project, "node_modules", "ignored"), { recursive: true });
  await fs.writeFile(path.join(project, "lib", "workflow", "bounded-replay.ts"), "export const replay = 'bounded replay needle';\n");
  await fs.writeFile(path.join(project, "lib", "workflow", "workflow-index.ts"), "export const index = 'workflow sparse needle';\n");
  await fs.writeFile(path.join(project, "skills", "deploy", "SKILL.md"), "# Deploy\nworkflow deployment skill needle\n");
  await fs.writeFile(path.join(project, ".env"), "SECRET=must-not-index\n");
  await fs.writeFile(path.join(project, "node_modules", "ignored", "workflow-secret.ts"), "must-not-index\n");
  return project;
}

describe("project candidate index", () => {
  beforeEach(async () => {
    await fs.rm(cache, { recursive: true, force: true });
  });
  afterAll(async () => {
    delete process.env.MSO_CANDIDATE_INDEX_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("builds a revision-invalidated owner-local sparse index and searches content only inside the path pool", async () => {
    const project = await resetProject();
    const first = await searchProjectCandidateIndex({
      projectPath: project, query: "workflow replay", revision: "rev-a", limit: 1,
    });
    expect(first.rebuilt).toBe(true);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0].path).toBe("lib/workflow/bounded-replay.ts");
    expect(first.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "lib/workflow/bounded-replay.ts", preview: expect.stringContaining("bounded replay needle") }),
    ]));
    expect(first.matches.every((match) => first.candidates.some((candidate) => candidate.path === match.path))).toBe(true);
    expect(JSON.stringify(first)).not.toContain("must-not-index");
    expect(first.truncated).toBe(true);
    expect(first.cursor).toBeTruthy();

    const second = await searchProjectCandidateIndex({
      projectPath: project, query: "workflow replay", revision: "rev-a", limit: 1, cursor: first.cursor,
    });
    expect(second.rebuilt).toBe(false);
    expect(second.candidates[0]?.path).not.toBe(first.candidates[0].path);

    const changedRevision = await searchProjectCandidateIndex({
      projectPath: project, query: "workflow replay", revision: "rev-b", limit: 2,
    });
    expect(changedRevision.rebuilt).toBe(true);
  });

  it("reuses only caller-supplied safe seed paths and does not fall back to a global walk", async () => {
    const project = await resetProject();
    await fs.writeFile(path.join(project, "lib", "workflow", "workflow-extra.ts"), "workflow extra global candidate\n");
    const reused = await searchProjectCandidateIndex({
      projectPath: project,
      query: "workflow",
      revision: "rev-reuse",
      seedPaths: ["lib/workflow/bounded-replay.ts", "../escape", ".env"],
      reuseOnly: true,
      limit: 20,
    });
    expect(reused.reusedSeed).toBe(true);
    expect(reused.rebuilt).toBe(false);
    expect(reused.indexedEntries).toBe(1);
    expect(reused.candidates.map((candidate) => candidate.path)).toEqual(["lib/workflow/bounded-replay.ts"]);
    expect(JSON.stringify(reused)).not.toContain("workflow-extra.ts");
    expect(JSON.stringify(reused)).not.toContain("SECRET=");
  });
});

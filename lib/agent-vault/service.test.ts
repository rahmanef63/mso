import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const fixtures = vi.hoisted(() => ({ projects: new Map<string, { id: string; name: string; path: string }>() }));
vi.mock("@/lib/host/projects-api", () => ({
  resolveProjectHint: vi.fn(async (hint: string) => fixtures.projects.get(hint) || null),
  projectGitEdits: vi.fn(async () => ({ edits: [{ sha: "a".repeat(40), shortSha: "aaaaaaa", createdAt: "2026-01-01T00:00:00Z", author: "Fixture agent", subject: "Record verified task" }], pagination: { hasMore: false } })),
}));
import { getAgentVault, syncAgentVault } from "./service";
import { vaultDirectory } from "./store";
let root: string;
async function put(relative: string, body: string) {
  const file = path.join(root, "repos", "one", relative);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, body, { mode: 0o600 });
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-vault-test-"));
  vi.stubEnv("OS_FS_READ_ROOTS", root); vi.stubEnv("OS_FS_WRITE_ROOTS", path.join(root, "data")); vi.stubEnv("OS_AGENT_VAULT_ROOT", path.join(root, "data"));
  await fs.mkdir(path.join(root, "data"), { mode: 0o700 });
  for (const name of ["one", "two"]) {
    const project = { id: `fixture/${name}`, name: "same-name", path: path.join(root, "repos", name) };
    await fs.mkdir(project.path, { recursive: true, mode: 0o700 });
    fixtures.projects.set(name, project);
  }
  await put("wiki/agents/worker.md", "---\nid: worker\nstatus: active\n---\n# Worker\n\nTask result from the repository.");
  await put("wiki/log.md", "# Progress\n\nVerified a task, deployment still unverified.");
});
afterEach(async () => { fixtures.projects.clear(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
describe("separate repository agent vault", () => {
  it("keeps user data outside source repos, isolates same-name repos and supports read-only discovery", async () => {
    const before = await fs.readFile(path.join(root, "repos/one/wiki/log.md"), "utf8");
    const empty = await getAgentVault("one");
    expect(empty.state.current).toBeNull();
    expect(await fs.stat(empty.state.root).catch(() => null)).toBeNull();
    const one = await syncAgentVault("one"), two = await syncAgentVault("two");
    expect(one.state.root).not.toBe(two.state.root);
    expect(one.state.root.startsWith(path.join(root, "data"))).toBe(true);
    expect(one.state.snapshots[0].notes.some(n => n.kind === "agent")).toBe(true);
    expect(two.state.snapshots[0].notes.some(n => n.kind === "agent")).toBe(false);
    expect(await fs.readFile(path.join(root, "repos/one/wiki/log.md"), "utf8")).toBe(before);
    expect((await fs.stat(one.state.root)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(one.state.root, "manifest.json"))).mode & 0o777).toBe(0o600);
  });
  it("deduplicates unchanged data and preserves earlier snapshots, including user edits", async () => {
    const first = await syncAgentVault("one"), id = first.state.current!;
    expect((await syncAgentVault("one")).changed).toBe(false);
    const old = first.state.snapshots[0].notes.find(n => n.kind === "agent")!;
    await fs.writeFile(path.join(first.state.root, old.path), "User annotation", { mode: 0o600 });
    await put("wiki/log.md", "# Progress\n\nSecond task completed.");
    const next = await syncAgentVault("one");
    expect(next.state.current).not.toBe(id); expect(next.state.snapshots).toHaveLength(2);
    expect((await getAgentVault("one", old.path)).note?.content).toBe("User annotation");
  });
  it("excludes unrelated private data, adapter configs, transcripts and nested archived deposits; redacts summaries", async () => {
    const syntheticSecret = ["sk", "secret12345678"].join("_");
    await put("wiki/agents/worker.md", `# Worker\n\napi_key=${syntheticSecret}\nFinished task.`);
    for (const relative of ["raw/chat.md", "wiki/people/private.md", "adapters/hermes/profile.md", "inbox/hermes/archive/transcript.md"]) await put(relative, "PRIVATE-TRANSCRIPT");
    const result = await syncAgentVault("one");
    const texts = await Promise.all(result.state.snapshots[0].notes.map(n => getAgentVault("one", n.path)));
    const bodies = texts.map(n => n.note?.content).join("\n");
    expect(bodies).not.toContain("PRIVATE-TRANSCRIPT"); expect(bodies).not.toContain(syntheticSecret); expect(bodies).toContain("[redacted]");
  });
  it("refuses traversal, cross-repository note reads and symlink source/target escapes", async () => {
    await fs.symlink(path.join(root, "repos/one/wiki/log.md"), path.join(root, "repos/one/wiki/agents/linked.md"));
    const one = await syncAgentVault("one"), two = await syncAgentVault("two");
    expect(one.state.snapshots[0].notes.some(n => n.source.endsWith("linked.md"))).toBe(false);
    await expect(getAgentVault("one", "../repos/one/wiki/log.md")).rejects.toThrow("not part");
    await expect(getAgentVault("two", one.state.snapshots[0].notes[0].path)).rejects.toThrow("not part");
    const selected = two.state.snapshots[0].notes[0];
    await fs.unlink(path.join(two.state.root, selected.path));
    await fs.symlink(path.join(root, "repos/one/wiki/log.md"), path.join(two.state.root, selected.path));
    await expect(getAgentVault("two", selected.path)).rejects.toThrow("symlinks");
  });
  it("fails closed on corrupt manifests and on source-overlapping vault storage", async () => {
    const result = await syncAgentVault("one");
    await fs.writeFile(path.join(result.state.root, "manifest.json"), "broken-json");
    await expect(getAgentVault("one")).rejects.toThrow();
    vi.stubEnv("OS_AGENT_VAULT_ROOT", path.join(root, "repos/one"));
    expect(() => vaultDirectory(fixtures.projects.get("one")!)).toThrow("outside");
    vi.stubEnv("OS_AGENT_VAULT_ROOT", path.join(process.cwd(), "user-data"));
    expect(() => vaultDirectory(fixtures.projects.get("one")!)).toThrow("MSO source checkout");
  });
  it("marks oversized sources as partial and does not read them", async () => {
    await put("wiki/agents/large.md", "x".repeat(50 * 1024));
    const result = await syncAgentVault("one"), snapshot = result.state.snapshots[0];
    expect(snapshot.truncated).toBe(true); expect(snapshot.warnings.join(" ")).toContain("oversized");
    expect(snapshot.notes.some(n => n.source.endsWith("large.md"))).toBe(false);
  });
});

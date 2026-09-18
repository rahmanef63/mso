import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveWorkflowSurface, surfaceRegistrySnapshot } from "./manage";
let dir: string, file: string;
const app = { id: "workflow-editor", title: "Editor", description: "Owner-approved editor", origin: "https://automation.example.test", startPath: "/editor", externalAuthPath: "/signin", renderer: "iframe", presentation: "inline", environment: "production" };
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-surface-test-")); file = path.join(dir, "registry.json"); vi.stubEnv("MSO_SURFACE_APPS_FILE", file); vi.stubEnv("MSO_SURFACE_APPS_JSON", undefined); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });
const save = async (value: Record<string, unknown> = app) => saveWorkflowSurface({ app: value, expectedRevision: (await surfaceRegistrySnapshot()).revision, confirm: true });
describe("owner-reviewed workflow surface configuration", () => {
  it("starts empty and preserves unrelated entries through an exact revision update", async () => {
    expect((await surfaceRegistrySnapshot()).apps).toEqual([]);
    const unrelated = { ...app, id: "existing-page", arbitraryFutureField: "preserve" };
    await fs.writeFile(file, JSON.stringify([unrelated]));
    const before = await surfaceRegistrySnapshot();
    const out = await save();
    const entries = JSON.parse(await fs.readFile(file, "utf8"));
    expect(entries[0]).toEqual(unrelated); expect(entries[1]).toMatchObject({ ...app, placements: ["workflows"] });
    expect(out.revision).not.toBe(before.revision); expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });
  it.each([undefined, ["mcp-page"], ["workflows", "mcp-page"]])("preserves prior Page approval when updating %j", async placements => {
    await fs.writeFile(file, JSON.stringify([{ ...app, ...(placements ? { placements } : {}) }]));
    await save({ ...app, title: "Updated editor" });
    const saved = (await surfaceRegistrySnapshot()).apps[0];
    expect(saved.title).toBe("Updated editor");
    expect(saved.placements).toEqual(["workflows", "mcp-page"]);
    await save({ ...app, title: "Updated again" });
    expect((await surfaceRegistrySnapshot()).apps[0].placements).toEqual(["workflows", "mcp-page"]);
  });
  it("preserves Page auth metadata with a validated query during workflow updates", async () => {
    const pageAuth = "/?auth=google";
    await fs.writeFile(file, JSON.stringify([{ ...app, externalAuthPath: pageAuth, placements: ["workflows", "mcp-page"] }]));
    await save({ ...app, externalAuthPath: pageAuth, title: "Workflow title" });
    let saved = (await surfaceRegistrySnapshot()).apps[0];
    expect(saved.externalAuthPath).toBe(pageAuth);
    expect(saved.placements).toEqual(["workflows", "mcp-page"]);
    await save({ ...app, title: "Workflow title again" });
    saved = (await surfaceRegistrySnapshot()).apps[0];
    expect(saved.externalAuthPath).toBe(pageAuth);
    await expect(save({ ...app, externalAuthPath: "/?auth=other" })).rejects.toThrow("workflow_login_path_must_not_contain_query");
  });
  it("does not inherit legacy Page approval from an invalid existing row", async () => {
    await fs.writeFile(file, JSON.stringify([{ ...app, title: "", placements: undefined }]));
    await save({ ...app, title: "Recovered workflow editor" });
    const saved = (await surfaceRegistrySnapshot()).apps[0];
    expect(saved.title).toBe("Recovered workflow editor");
    expect(saved.placements).toEqual(["workflows"]);
  });

  it("never adds Page approval to new or workflow-only entries", async () => {
    await save();
    expect((await surfaceRegistrySnapshot()).apps[0].placements).toEqual(["workflows"]);
    await save({ ...app, title: "Only workflows" });
    expect((await surfaceRegistrySnapshot()).apps[0].placements).toEqual(["workflows"]);
    await expect(save({ ...app, placements: ["workflows", "mcp-page"] })).rejects.toThrow("invalid_workflow_placement");
  });
  it("rejects stale updates and concurrent lost writes", async () => {
    const revision = (await surfaceRegistrySnapshot()).revision;
    await save();
    await expect(saveWorkflowSurface({ app: { ...app, title: "Changed" }, expectedRevision: revision, confirm: true })).rejects.toThrow("surface_registry_changed_reload");
    expect((await surfaceRegistrySnapshot()).apps[0].title).toBe("Editor");
  });
  it("replaces only the selected id and retains one stable identity", async () => {
    await save(); await save({ ...app, title: "Renamed" });
    expect((await surfaceRegistrySnapshot()).apps).toHaveLength(1);
    expect((await surfaceRegistrySnapshot()).apps[0].title).toBe("Renamed");
  });
  it("refuses environment-managed registries without writing a file", async () => {
    vi.stubEnv("MSO_SURFACE_APPS_JSON", "[]");
    await expect(save()).rejects.toThrow("surface_registry_managed_by_environment");
    expect((await surfaceRegistrySnapshot()).configurable).toBe(false);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([{ accessToken: "not-accepted" }, { origin: "http://unsafe.example.test" }, { externalAuthPath: "/signin?token=bad" }, { placements: ["settings"] }])("refuses unsafe or secret-bearing configuration %j", async (change) => {
    await expect(save({ ...app, ...change })).rejects.toThrow();
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("requires explicit review and refuses caller-provided filesystem paths", async () => {
    await expect(saveWorkflowSurface({ app, expectedRevision: "x", confirm: false })).rejects.toThrow("explicit_review_required");
    await expect(saveWorkflowSurface({ app, expectedRevision: "x", confirm: true, path: file })).rejects.toThrow("explicit_review_required");
  });
  it("does not overwrite malformed existing configuration", async () => {
    await fs.writeFile(file, "{broken");
    await expect(save()).rejects.toThrow("invalid_existing_surface_registry");
    expect(await fs.readFile(file, "utf8")).toBe("{broken");
  });
  it("refuses duplicate identities and registry overflow", async () => {
    await fs.writeFile(file, JSON.stringify([app, app])); await expect(save()).rejects.toThrow("duplicate_surface_identity");
    await fs.writeFile(file, JSON.stringify(Array.from({ length: 16 }, (_, i) => ({ ...app, id: `other-${i}` }))));
    await expect(save()).rejects.toThrow("surface_registry_capacity");
  });
});

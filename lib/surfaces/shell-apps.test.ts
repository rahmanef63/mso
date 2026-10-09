import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { manageShellApp, shellAppSettings } from "./shell-apps";
import { configuredSurfaceApps } from "./config";
import { saveWorkflowSurface } from "./manage";

let dir: string, file: string;
const origin = "https://cockpit.example.test";
const app = { id: "custom-editor", title: "Custom editor", description: "My tool", url: "https://editor.example.test/editor", mode: "embed" };
const save = async (change: Record<string, unknown> = {}, action = "add") => manageShellApp({ schemaVersion: 1, action, app: { ...app, ...change }, expectedRevision: (await shellAppSettings(origin)).revision, confirm: true }, origin);
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-shell-app-")); file = path.join(dir, "registry.json");
  vi.stubEnv("MSO_SURFACE_APPS_FILE", file); vi.stubEnv("MSO_SURFACE_APPS_JSON", undefined);
  vi.stubEnv("OS_PUBLIC_ORIGIN", origin); vi.stubEnv("OS_MCP_UI_ORIGIN", "https://widgets.example.test");
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "");
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });

describe("server-owned connected applications", () => {
  it("exposes the MSO login mode without disclosing the loopback target and preserves it on metadata edits", async () => {
    await save();
    const entries = JSON.parse(await fs.readFile(file, "utf8"));
    entries[0].sessionUpstream = "http://127.0.0.1:9131";
    await fs.writeFile(file, JSON.stringify(entries), { mode: 0o600 });
    expect((await shellAppSettings(origin)).apps[0]).toMatchObject({ msoSession: true });
    expect(JSON.stringify(await shellAppSettings(origin))).not.toContain("127.0.0.1");
    await save({ title: "Renamed" }, "update");
    expect((await configuredSurfaceApps())[0].sessionUpstream).toBe("http://127.0.0.1:9131");
    await save({ url: "https://replacement.example.test/" }, "update");
    expect((await configuredSurfaceApps())[0].sessionUpstream).toBeUndefined();
  });
  it("persists a reviewed embed, edits it by revision and disconnects only its metadata", async () => {
    const before = await shellAppSettings(origin);
    await save();
    let snapshot = await shellAppSettings(origin);
    expect(snapshot.schemaVersion).toBe(1); expect(snapshot.revision).not.toBe(before.revision);
    expect(snapshot.apps[0]).toMatchObject({ title: app.title, url: app.url, renderer: "iframe" });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await save({ title: "Renamed" }, "update");
    snapshot = await shellAppSettings(origin);
    expect(snapshot.apps[0].title).toBe("Renamed");
    await manageShellApp({ schemaVersion: 1, action: "remove", id: app.id, expectedRevision: snapshot.revision, confirm: true }, origin);
    expect((await shellAppSettings(origin)).apps).toEqual([]);
  });
  it("supports an IP without a domain as a separate-tab destination", async () => {
    await save({ url: "http://192.0.2.10:5678/" });
    expect((await shellAppSettings(origin)).apps[0]).toMatchObject({ renderer: "remote", url: "http://192.0.2.10:5678/" });
    const row = JSON.parse(await fs.readFile(file, "utf8"))[0];
    expect(await configuredSurfaceApps(JSON.stringify([{ ...row, placements: ["mcp-page"] }]))).toEqual([]);
    expect(await configuredSurfaceApps(JSON.stringify([{ ...row, placements: ["shell", "mcp-page"] }]))).toEqual([]);
    expect(await configuredSurfaceApps(JSON.stringify([{ ...row, renderer: "iframe" }]))).toEqual([]);
  });
  it.each([origin, "https://cockpit.example.test:9443", "http://cockpit.example.test:5678", "https://widgets.example.test"])("rejects cockpit cookie/origin conflicts: %s", async url => {
    await expect(save({ url })).rejects.toThrow("app_cookie_scope_conflict");
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([
    { url: "javascript:alert(1)" }, { url: "https://user:password@editor.example.test" },
    { url: "https://editor.example.test/?token=private" }, { url: "https://editor.example.test/#token" },
    { token: "not-allowed" }, { command: "run-tool" }, { id: "../escape" }, { mode: "native" },
  ])("rejects executable and secret-bearing metadata %j", async change => { await expect(save(change)).rejects.toThrow(); });
  it("never overwrites another placement or grants MCP Page visibility", async () => {
    const other = { id: app.id, title: "Page", origin: "https://page.example.test", startPath: "/", description: "", renderer: "iframe", presentation: "inline", environment: "production" };
    await fs.writeFile(file, JSON.stringify([other]));
    await expect(save()).rejects.toThrow("app_id_exists");
    await expect(save({}, "update")).rejects.toThrow("app_owned_by_another_surface");
    await save({ id: "second" });
    expect(JSON.parse(await fs.readFile(file, "utf8"))[0]).toEqual(other);
    expect((await shellAppSettings(origin)).apps).toHaveLength(1);
    expect((await configuredSurfaceApps()).find(row => row.id === "second")?.placements).toEqual(["shell"]);
  });
  it("rejects a stale mutation and concurrent lost writes", async () => {
    const revision = (await shellAppSettings(origin)).revision;
    const request = { schemaVersion: 1, action: "add", app, expectedRevision: revision, confirm: true };
    const results = await Promise.allSettled([manageShellApp(request, origin), manageShellApp({ ...request, app: { ...app, id: "other" } }, origin)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await shellAppSettings(origin)).apps).toHaveLength(1);
  });
  it("shares revision authority with workflow surfaces and preserves their entries", async () => {
    await save();
    await saveWorkflowSurface({ app: { id: "n8n", title: "n8n", description: "", origin: "https://automation.example.test", startPath: "/", renderer: "iframe", presentation: "inline", environment: "production", placements: ["n8n"] }, expectedRevision: (await shellAppSettings(origin)).revision, confirm: true });
    await save({ title: "New title" }, "update");
    expect((await configuredSurfaceApps()).map(row => row.id)).toEqual([app.id, "n8n"]);
  });
  it("prevents workflow updates from taking ownership of shell entries", async () => {
    await save();
    const before = await fs.readFile(file, "utf8");
    await expect(saveWorkflowSurface({ app: { id: app.id, title: "Replacement", description: "", origin: "https://automation.example.test", startPath: "/", renderer: "iframe", presentation: "inline", environment: "production", placements: ["n8n"] }, expectedRevision: (await shellAppSettings(origin)).revision, confirm: true })).rejects.toThrow("surface_owned_by_shell");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
  it("blocks previously configured entries when cockpit origin changes", async () => {
    await save();
    const snapshot = await shellAppSettings("https://editor.example.test");
    expect(snapshot.apps[0]).toMatchObject({ blocked: true, renderer: "remote" });
    expect(snapshot.apps[0].url).toBeUndefined();
  });
  it("rejects malformed and environment-owned stores without modifying them", async () => {
    await fs.writeFile(file, "{broken");
    await expect(save()).rejects.toThrow("invalid_existing_surface_registry");
    expect(await fs.readFile(file, "utf8")).toBe("{broken");
    vi.stubEnv("MSO_SURFACE_APPS_JSON", "[]");
    await expect(save()).rejects.toThrow("surface_registry_managed_by_environment");
  });
  it("requires the supported wire version and explicit review", async () => {
    const base = { schemaVersion: 1, action: "add", app, expectedRevision: (await shellAppSettings(origin)).revision, confirm: true };
    await expect(manageShellApp({ ...base, schemaVersion: 2 }, origin)).rejects.toThrow("invalid_shell_request");
    await expect(manageShellApp({ ...base, confirm: false }, origin)).rejects.toThrow("invalid_shell_request");
  });
  it("imports one manifest into independent bindings and preserves provenance on edit", async () => {
    const manifest = { schema: "urn:mso:connected-app:v1", schemaVersion: 1, id: "tool", version: "1.0.0", title: "Template tool", description: "", publisher: "Local developer", presentation: "embed" };
    const request = async (id: string, url = app.url, extra = {}) => manageShellApp({ schemaVersion: 1, action: "import", manifest, binding: { id, url, mode: "embed" }, expectedRevision: (await shellAppSettings(origin)).revision, confirm: true, ...extra }, origin);
    await request("first"); await request("second", "http://192.0.2.10:5678/");
    let snapshot = await shellAppSettings(origin);
    expect(snapshot.apps.map(row => row.definition.id)).toEqual(["first", "second"]);
    expect(snapshot.apps.map(row => row.manifest)).toEqual([manifest, manifest]);
    expect(snapshot.apps[1].renderer).toBe("remote");
    await save({ id: "first", title: "Instance name" }, "update");
    snapshot = await shellAppSettings(origin);
    expect(snapshot.apps[0].manifest).toEqual(manifest);
    expect(snapshot.apps[0].title).toBe("Instance name");
    const before = await fs.readFile(file, "utf8");
    await expect(request("first")).rejects.toThrow("app_id_exists");
    await expect(request("third", origin)).rejects.toThrow("app_cookie_scope_conflict");
    await expect(request("third", app.url, { manifest: { ...manifest, command: "run-tool" } })).rejects.toThrow("invalid_app_manifest");
    await expect(request("third", app.url, { app })).rejects.toThrow("invalid_shell_request");
    await expect(request("third", app.url, { binding: { id: "third", url: app.url, mode: "embed", token: "not-allowed" } })).rejects.toThrow("invalid_shell_request");
    await expect(request("third", app.url, { confirm: false })).rejects.toThrow("invalid_shell_request");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

});

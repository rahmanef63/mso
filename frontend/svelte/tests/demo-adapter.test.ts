import assert from "node:assert/strict";
import test from "node:test";
import { readAgentGroups } from "../src/lib/agent-group/agent-group-api.ts";
import { readAgentVault, syncAgentVault } from "../src/lib/agent-vault/agent-vault-api.ts";
import { readModels } from "../src/lib/assistant/assistant-api.ts";
import { readAccountProfile, updateAccountProfile } from "../src/lib/auth/account-api.ts";
import { readAppCatalog, readModularFeatures, readSkills } from "../src/lib/catalog/catalog-api.ts";
import { readShellApps } from "../src/lib/create-app/create-app-api.ts";
import { createDemoFetch, installDemoFetch, isDemoMode, uninstallDemoFetch } from "../src/lib/demo/demo-adapter.ts";
import { readChangelog } from "../src/lib/docs/docs-api.ts";
import { createDirectory, deleteFsEntry, listDirectory, readTextFile, writeTextFile } from "../src/lib/files/files-api.ts";
import { copyFsEntry, moveFsEntry, searchFs } from "../src/lib/files/files-ops-api.ts";
import { readDevices, readSession, readStats } from "../src/lib/host-api.ts";
import { readInfraProviders } from "../src/lib/infra/infra-api.ts";
import { readChannels, readIntegrations, testChannel } from "../src/lib/integrations/integrations-api.ts";
import { readManagedApps, readPackages } from "../src/lib/managed-apps/managed-apps-api.ts";
import { readMemoryGraph } from "../src/lib/memory-graph/memory-graph-api.ts";
import { readProcesses } from "../src/lib/monitor/processes-api.ts";
import { readServices, runServiceAction } from "../src/lib/monitor/services-api.ts";
import { readOrganization } from "../src/lib/organization/org-api.ts";
import { readAuditLog, readSoftwareUpdate } from "../src/lib/settings/host-ops-api.ts";
import { readPrefs, savePrefs } from "../src/lib/settings/prefs-api.ts";
import { readWorkflowGraphs, readWorkflowRuns } from "../src/lib/workflows/workflows-api.ts";

const BRIDGE = { surface: "web" as const, apiBaseOrigin: null };
const SIG = () => new AbortController().signal;

test("isDemoMode recognizes ?demo=1, ?demo=true, and demo build mode", () => {
  assert.equal(isDemoMode({ search: "?demo=1" }, "production"), true);
  assert.equal(isDemoMode({ search: "?demo=true" }, "production"), true);
  assert.equal(isDemoMode({ search: "?foo=1&demo=TRUE" }, "production"), true);
  assert.equal(isDemoMode({ search: "" }, "demo"), true);
  assert.equal(isDemoMode({ search: "?demo=0" }, "production"), false);
  assert.equal(isDemoMode({ search: "?demo=false" }, "production"), false);
  assert.equal(isDemoMode({ search: "" }, "production"), false);
});

test("demo virtual filesystem supports list, read, write, mkdir, copy, move, search, delete, and usage", async () => {
  let networkCalls = 0;
  const baseFetch: typeof fetch = async () => {
    networkCalls++;
    throw new Error("baseFetch must not be called for /api/*");
  };
  const demoFetch = createDemoFetch(baseFetch);

  const home = await listDirectory("~", SIG(), demoFetch, BRIDGE);
  assert.equal(home.path, "/home/demo");
  assert.ok(home.entries.some((e) => e.name === "README.md" && e.kind === "file"));
  assert.ok(home.entries.some((e) => e.name === "projects" && e.kind === "dir"));

  const readme = await readTextFile("/home/demo/README.md", SIG(), demoFetch, BRIDGE);
  assert.match(readme, /MSO Demo Workspace/);

  await createDirectory("/home/demo/scratch", SIG(), demoFetch, BRIDGE);
  await writeTextFile("/home/demo/scratch/hello.txt", "hello offline demo", SIG(), demoFetch, BRIDGE);
  assert.equal(await readTextFile("/home/demo/scratch/hello.txt", SIG(), demoFetch, BRIDGE), "hello offline demo");

  await copyFsEntry("/home/demo/scratch/hello.txt", "/home/demo/scratch/copy.txt", SIG(), demoFetch, BRIDGE);
  assert.equal(await readTextFile("/home/demo/scratch/copy.txt", SIG(), demoFetch, BRIDGE), "hello offline demo");

  await moveFsEntry("/home/demo/scratch/copy.txt", "/home/demo/scratch/moved.txt", SIG(), demoFetch, BRIDGE);
  assert.equal(await readTextFile("/home/demo/scratch/moved.txt", SIG(), demoFetch, BRIDGE), "hello offline demo");
  await assert.rejects(() => readTextFile("/home/demo/scratch/copy.txt", SIG(), demoFetch, BRIDGE));

  const hits = await searchFs("offline demo", "/home/demo/scratch", SIG(), demoFetch, BRIDGE);
  assert.equal(hits.length, 2);

  await deleteFsEntry("/home/demo/scratch", SIG(), demoFetch, BRIDGE);
  await assert.rejects(() => listDirectory("/home/demo/scratch", SIG(), demoFetch, BRIDGE));

  const usageRes = await demoFetch("/api/v1/fs/usage?path=/home/demo");
  const usage = await usageRes.json() as { files: number; bytes: number };
  assert.ok(usage.files >= 4 && usage.bytes > 0);
  assert.equal(networkCalls, 0);
});

test("demo /api/prefs persists only in session memory and stays isolated per instance", async () => {
  let networkCalls = 0;
  const demoA = createDemoFetch(async () => { networkCalls++; throw new Error("unexpected"); });
  const demoB = createDemoFetch(async () => { networkCalls++; throw new Error("unexpected"); });

  const initial = await readPrefs(SIG(), demoA, BRIDGE);
  assert.equal(initial.tweaks?.theme, "system");

  await savePrefs(
    {
      tweaks: { theme: "dark", reducedMotion: true, shell: { desktop: "windows", mobile: "android" }, wallpaper: "win11" },
      quicklinks: [{ id: "demo-1", title: "Local Docs", url: "https://example.com/docs" }],
    },
    SIG(),
    demoA,
    BRIDGE,
  );

  const updated = await readPrefs(SIG(), demoA, BRIDGE);
  assert.equal(updated.tweaks?.theme, "dark");
  assert.equal(updated.tweaks?.reducedMotion, true);
  assert.equal(updated.tweaks?.wallpaper, "win11");
  assert.equal(updated.quicklinks?.[0]?.id, "demo-1");

  const fresh = await readPrefs(SIG(), demoB, BRIDGE);
  assert.equal(fresh.tweaks?.theme, "system");
  assert.equal(networkCalls, 0);
});

test("demo fetch satisfies all 33-app API contracts with zero network calls", async () => {
  let networkCalls = 0;
  const baseFetch: typeof fetch = async (input) => {
    networkCalls++;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(`asset:${url}`, { status: 200 });
  };
  const demoFetch = createDemoFetch(baseFetch);

  const session = await readSession(SIG(), demoFetch, BRIDGE);
  assert.deepEqual(session, {
    authenticated: true,
    deviceId: "demo-visitor",
    deviceLabel: "MSO Interactive Demo",
    role: "owner",
  });

  const stats = await readStats(SIG(), demoFetch, BRIDGE);
  assert.ok(stats.cpu.cores >= 1 && stats.mem.total > 0 && stats.disk.total > 0);

  const devices = await readDevices(SIG(), demoFetch, BRIDGE);
  assert.ok("demo-visitor" in devices.approved);

  const account = await readAccountProfile(SIG(), demoFetch, BRIDGE);
  assert.equal(account.name, "Demo Operator");
  const renamed = await updateAccountProfile({ name: "Visitor" }, SIG(), demoFetch, BRIDGE);
  assert.equal(renamed.name, "Visitor");

  const procs = await readProcesses(SIG(), demoFetch, BRIDGE);
  assert.ok(procs.length >= 2);
  const services = await readServices(SIG(), demoFetch, BRIDGE);
  assert.ok(services.services.length >= 1);
  const stopped = await runServiceAction({ scope: "system", unit: "mso.service", action: "stop" }, SIG(), demoFetch, BRIDGE);
  assert.equal(stopped.active, "inactive");

  const pkgs = await readPackages(SIG(), demoFetch, BRIDGE);
  assert.equal(pkgs.available, true);
  const upd = await readSoftwareUpdate(SIG(), demoFetch, BRIDGE);
  assert.equal(upd.supported, true);
  const audit = await readAuditLog(SIG(), demoFetch, BRIDGE);
  assert.ok(audit.length >= 1);

  const graphs = await readWorkflowGraphs(SIG(), demoFetch, BRIDGE);
  assert.equal(graphs.length, 1);
  const runs = await readWorkflowRuns(SIG(), demoFetch, BRIDGE);
  assert.equal(runs.total, 1);

  const apps = await readManagedApps(SIG(), demoFetch, BRIDGE);
  assert.equal(apps[0]?.id, "n8n");
  const integrations = await readIntegrations(SIG(), demoFetch, BRIDGE);
  assert.ok(integrations.connections.some((c) => c.provider === "convex"));
  const channels = await readChannels(SIG(), demoFetch, BRIDGE);
  assert.equal(channels.channels.length, 1);
  const chTest = await testChannel("ch-demo", SIG(), demoFetch, BRIDGE);
  assert.equal(chTest.ok, true);

  const infra = await readInfraProviders(SIG(), demoFetch, BRIDGE);
  assert.ok(infra.providers.some((p) => p.id === "dokploy"));
  const org = await readOrganization(SIG(), demoFetch, BRIDGE);
  assert.equal(org.chart.units.length, 1);
  const mem = await readMemoryGraph(SIG(), demoFetch, BRIDGE);
  assert.equal(mem.nodes.length, 2);
  const catalog = await readAppCatalog(SIG(), demoFetch, BRIDGE);
  assert.equal(catalog.entries.length, 2);
  const features = await readModularFeatures(SIG(), demoFetch, BRIDGE);
  assert.equal(features.features.length, 1);
  const skills = await readSkills(SIG(), demoFetch, BRIDGE);
  assert.equal(skills.skills.length, 1);
  const vault = await readAgentVault({}, SIG(), demoFetch, BRIDGE);
  assert.equal(vault.state.project.id, "mso-demo");
  const synced = await syncAgentVault(undefined, SIG(), demoFetch, BRIDGE);
  assert.equal(synced.changed, false);
  const groups = await readAgentGroups(SIG(), demoFetch, BRIDGE);
  assert.equal(groups.groups.length, 1);
  const shellApps = await readShellApps(SIG(), demoFetch, BRIDGE);
  assert.equal(shellApps.schemaVersion, 1);
  const changelog = await readChangelog(SIG(), demoFetch, BRIDGE);
  assert.equal(changelog.generated, true);
  const models = await readModels(SIG(), demoFetch, BRIDGE);
  assert.equal(models.length, 1);

  assert.equal((await demoFetch("/api/health")).status, 200);
  assert.equal((await demoFetch("/api/status")).status, 200);
  assert.equal(networkCalls, 0);

  const assetRes = await demoFetch("/wallpapers/aurora.webp");
  assert.equal(await assetRes.text(), "asset:/wallpapers/aurora.webp");
  assert.equal(networkCalls, 1);
});

test("installDemoFetch patches globalThis.fetch idempotently and uninstallDemoFetch restores it", async () => {
  const original = globalThis.fetch;
  try {
    const first = installDemoFetch(async () => { throw new Error("should not reach network"); });
    const second = installDemoFetch();
    assert.equal(first, second);
    assert.equal(globalThis.fetch, first);
    const res = await globalThis.fetch("/api/health");
    assert.equal(res.status, 200);
  } finally {
    uninstallDemoFetch();
  }
  assert.equal(globalThis.fetch, original);
});

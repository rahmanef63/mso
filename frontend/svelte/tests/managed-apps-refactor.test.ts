import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseBackups, parseDiscovery, parseJobs, parseLogs, parsePreflight, parseTunnels, parseUpdateStatus,
} from "../src/lib/managed-apps/appdeck-schema.ts";
import { safeMessage } from "../src/lib/managed-apps/appdeck-api.ts";
import {
  appTone, filterApps, hasActiveJob, isDestructive, jobTone, joinLogEntries, lastLine,
  lifecycleActions, LOG_LINE_CAP, tabCounts, tunnelsLabel, tunnelsSummary, confirmKey,
} from "../src/lib/managed-apps/appdeck-view.ts";
import {
  ariaSort, filterPackages, nextDirection, packageCounts, packageStatus, sortPackages,
} from "../src/lib/managed-apps/packages-view.ts";
import { brandFor, loopbackUrl } from "../src/lib/managed-apps/appdeck-catalog.ts";
import { createAppDeckDetail } from "../src/lib/managed-apps/appdeck-detail.ts";
import { createAppDeckOverview } from "../src/lib/managed-apps/appdeck-overview.ts";
import {
  SLICE, app, backupsPayload, createDetailFetcher, discoveryPayload, job, overviewFetcher,
  packageUpdates, preflightPayload, signal, tunnelsPayload, updatePackagePayload, updateStatusPayload,
} from "./managed-apps-refactor-fixtures.ts";

test("schema parsers accept the documented payloads", () => {
  assert.equal(parseJobs({ jobs: [job] })[0]?.kind, "update");
  assert.equal(parseLogs({ available: true, entries: ["line"] }).entries.length, 1);
  assert.equal(parseBackups(backupsPayload)[0]?.reason, "manual");
  assert.equal(parsePreflight(preflightPayload).ready, true);
  assert.equal(parseDiscovery(discoveryPayload).apps.length, 1);
  assert.equal(parseTunnels(tunnelsPayload).tunnels[0]?.active, true);
  assert.equal(parseUpdateStatus(updateStatusPayload).updateAvailable, true);
});

test("schema parsers fail closed on foreign shapes", () => {
  const bad = [null, {}, [], { jobs: [null] }, { jobs: [{ ...job, kind: "reinstall" }] },
    { jobs: [{ ...job, status: "done" }] }, { jobs: [{ ...job, argv: [1] }] }];
  for (const payload of bad) assert.throws(() => parseJobs(payload), /job list response is invalid/);
  assert.throws(() => parseLogs({ available: true, entries: [1] }), /app log response is invalid/);
  assert.throws(() => parseBackups({ backups: [{ ...job }] }), /backup list response is invalid/);
  assert.throws(() => parsePreflight({ appId: "x" }), /preflight response is invalid/);
  assert.throws(() => parsePreflight({
    appId: "x", appName: "X", installed: true, ready: true, summary: "", backend: "systemd",
    checks: [], checkedAt: "2026-11-21T19:00:00.000Z",
  }), /preflight response is invalid/);
  assert.throws(() => parseDiscovery({ checkedAt: "", dockerAvailable: true, apps: [] }), /local discovery response is invalid/);
  assert.throws(() => parseTunnels({ sshAvailable: true, tunnels: [{ id: "t" }] }), /tunnel response is invalid/);
  assert.throws(() => parseUpdateStatus({ currentVersion: 1 }), /update status response is invalid/);
});

test("safeMessage never echoes upstream bodies or stack traces", () => {
  assert.match(safeMessage(401, "Preflight"), /device is not an owner/);
  assert.match(safeMessage(403, "Preflight"), /device is not an owner/);
  assert.match(safeMessage(404, "Application log"), /Application log was not found/);
  assert.match(safeMessage(409, "Lifecycle action"), /busy or the operation was refused/);
  assert.match(safeMessage(429, "Preflight"), /Too many operations/);
  assert.match(safeMessage(503, "Tunnel list"), /temporarily unavailable/);
  for (const status of [400, 418, 500]) {
    const message = safeMessage(status, "Preflight");
    assert.ok(!message.includes("Error") && !message.includes("at "));
    assert.ok(message.includes(String(status)));
  }
});

test("overview filters, tab counts, and lifecycle affordances match host state", () => {
  const apps = [
    app(),
    app({ id: "n8n", name: "n8n", installed: true, state: "stopped", healthy: null, supportedActions: ["start"] }),
    app({ id: "orca", name: "Orca", installed: false, state: "not-installed", healthy: null, supportedActions: [] }),
  ];
  assert.deepEqual(tabCounts(apps), { all: 3, running: 1, installed: 2, available: 1 });
  assert.equal(filterApps(apps, "running", "").length, 1);
  assert.equal(filterApps(apps, "available", "").length, 1);
  assert.equal(filterApps(apps, "all", "ORCA").length, 1);
  assert.equal(filterApps(apps, "all", "   ").length, 3);
  assert.equal(appTone(apps[0]!), "ok");
  assert.equal(appTone(app({ state: "unhealthy" })), "danger");
  assert.equal(appTone(app({ state: "starting" })), "warn");
  assert.equal(appTone(app({ state: "stopped", healthy: null })), "neutral");
  assert.deepEqual(lifecycleActions(apps[0]!, apps[0]!.supportedActions), {
    start: false, stop: true, restart: true, backup: true,
  });
  assert.deepEqual(lifecycleActions(apps[1]!, apps[1]!.supportedActions), {
    start: true, stop: false, restart: true, backup: false,
  });
  assert.equal(isDestructive("stop"), true);
  assert.equal(isDestructive("restart"), false);
  assert.equal(confirmKey("hermes", "stop"), "hermes:stop");
});

test("tunnel summary and job log helpers stay bounded", () => {
  assert.equal(tunnelsLabel(tunnelsSummary([]), false), "SSH tunnels unavailable on this host");
  assert.equal(tunnelsLabel(tunnelsSummary([]), true), "No SSH tunnels configured");
  assert.equal(tunnelsLabel(tunnelsSummary([{ active: true }, { active: false }]), true), "1 of 2 SSH tunnels active");
  const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
  const joined = joinLogEntries(lines);
  assert.equal(joined.split("\n").length, LOG_LINE_CAP);
  assert.equal(lastLine(joined), "line 499");
  assert.equal(lastLine("\n\n"), "");
  assert.equal(hasActiveJob([{ status: "queued" }]), true);
  assert.equal(hasActiveJob([{ status: "succeeded" }]), false);
  assert.equal(jobTone("failed"), "danger");
  assert.equal(jobTone("running"), "warn");
  assert.equal(jobTone("interrupted"), "neutral");
});

test("package cache view filters, counts, and sorts without mutating input", () => {
  const updates = [...packageUpdates];
  assert.equal(packageStatus(updates[0]!), "upgradable");
  assert.equal(packageStatus(updates[1]!), "installed");
  assert.equal(packageStatus(updates[2]!), "unknown");
  assert.deepEqual(packageCounts({ updates, truncated: true }), {
    total: 3, upgradable: 1, installed: 1, unknown: 1, truncated: true,
  });
  assert.deepEqual(filterPackages(updates, "upgradable", "").map((p) => p.name), ["openssl"]);
  assert.deepEqual(filterPackages(updates, "installed", "").map((p) => p.name), ["curl"]);
  assert.deepEqual(filterPackages(updates, "unknown", "").map((p) => p.name), ["nodejs"]);
  assert.deepEqual(filterPackages(updates, "all", "ARM").map((p) => p.name), ["nodejs"]);
  // Numeric collation: 3.0.13.4 < 8.5.0 < 20.1.0.
  assert.deepEqual(filterPackages(updates, "all", "", "candidate", "asc").map((p) => p.name), ["openssl", "curl", "nodejs"]);
  assert.deepEqual(filterPackages(updates, "all", "", "name", "desc").map((p) => p.name), ["openssl", "nodejs", "curl"]);
  const original = updates.map((p) => p.name);
  sortPackages(updates, "name", "desc");
  assert.deepEqual(updates.map((p) => p.name), original);
  assert.equal(nextDirection("asc"), "desc");
  assert.equal(ariaSort(false, "asc"), "none");
  assert.equal(ariaSort(true, "desc"), "descending");
});

test("brand catalog covers every managed app id and refuses bogus ports", () => {
  for (const id of ["hermes", "openclaw", "9router", "orca", "t3", "n8n"]) {
    assert.ok(brandFor(id).port > 0, id);
  }
  assert.equal(brandFor("unknown-app", "Custom").name, "Custom");
  assert.equal(brandFor("unknown-app").glyph, "?");
  assert.equal(loopbackUrl(0), null);
  assert.equal(loopbackUrl(70000), null);
  assert.equal(loopbackUrl(5678), "http://127.0.0.1:5678");
});

test("detail controller loads tabs, re-reads after an action, and drops late answers", async () => {
  const seen: string[] = [];
  let lastDetail: Record<string, unknown> | null = null;
  const { fetcher, actionPosts } = createDetailFetcher(seen);
  const ctrl = createAppDeckDetail("hermes", (next) => { lastDetail = next as unknown as Record<string, unknown>; }, { fetcher });
  await ctrl.loadTab("lifecycle");
  assert.ok(seen.some((line) => line.endsWith("/preflight")));
  assert.equal((lastDetail!.preflight as { kind: string }).kind, "ready");
  ctrl.setTab("jobs");
  await ctrl.loadTab("jobs");
  assert.equal((lastDetail!.jobs as { kind: string }).kind, "ready");
  assert.equal((lastDetail!.logs as { kind: string }).kind, "ready");
  await ctrl.act("restart");
  assert.equal(actionPosts(), 1);
  assert.match(String(lastDetail!.notice), /restart requested/);
  assert.equal(lastDetail!.busy, null);
  ctrl.dispose();
  const before = seen.length;
  await ctrl.loadJobs();
  assert.equal(seen.length, before, "a disposed controller must not fetch");
});

test("detail controller maps a refused lifecycle action without leaking the body", async () => {
  let detail: Record<string, unknown> | null = null;
  const fetcher: typeof fetch = async () => Response.json({ error: "systemctl failed at /home/a/.hermes" }, { status: 409 });
  const ctrl = createAppDeckDetail("hermes", (next) => { detail = next as unknown as Record<string, unknown>; }, { fetcher });
  await ctrl.act("stop");
  assert.match(String(detail!.error), /busy or the operation was refused/);
  assert.ok(!String(detail!.error).includes("/home/a"));
  ctrl.dispose();
});

test("overview controller keeps discovery and tunnel failures independent", async () => {
  const fetcher = overviewFetcher;
  let state: Record<string, unknown> | null = null;
  const ctrl = createAppDeckOverview((next) => { state = next as unknown as Record<string, unknown>; }, fetcher);
  ctrl.refresh();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((state!.apps as { kind: string }).kind, "ready");
  assert.equal((state!.discovery as { kind: string }).kind, "ready");
  assert.equal((state!.tunnels as { kind: string }).kind, "error");
  assert.match(String((state!.tunnels as { message: string }).message), /not an owner/);
  ctrl.dispose();
});

test("slice sources keep the repo hard gates: no html injection, no raw dialogs, no storage, short lines", () => {
  const files = readdirSync(SLICE).filter((name) => /\.(ts|svelte)$/.test(name));
  assert.ok(files.length > 0);
  for (const name of files) {
    const text = readFileSync(resolve(SLICE, name), "utf8");
    assert.ok(!text.includes("{@html"), `${name} uses {@html}`);
    assert.ok(!/window\.(confirm|alert|prompt)\s*\(/.test(text), `${name} calls a raw dialog`);
    assert.ok(!/\b(localStorage|sessionStorage)\./.test(text), `${name} touches web storage`);
    for (const [index, line] of text.split("\n").entries()) {
      assert.ok(line.length <= 400, `${name}:${index + 1} is ${line.length} chars`);
      assert.ok(!line.includes("\u2014"), `${name}:${index + 1} has an em dash`);
    }
  }
  // Read-only means no mutation path at all, not just no button label.
  const view = readFileSync(resolve(SLICE, "PackagesView.svelte"), "utf8");
  for (const banned of ["method: \"POST\"", "method: \"PUT\"", "runLifecycle", "startInstall", "startUpdate",
    "applyUpdates", "upgradePackages"]) {
    assert.ok(!view.includes(banned), `the package panel must stay read-only (found ${banned})`);
  }
  assert.match(view, /Read-only/);
});

test("imports stay inside the slice and the shared shell seam", () => {
  const files = readdirSync(SLICE).filter((name) => /^appdeck-.*\.ts$/.test(name));
  for (const name of files) {
    const text = readFileSync(resolve(SLICE, name), "utf8");
    for (const match of text.matchAll(/from "([^"]+)"/g)) {
      const target = match[1]!;
      const local = target.startsWith("./");
      const shared = target === "../shell-bridge.ts" || target === "../host-api.ts";
      assert.ok(local || shared, `${name} imports ${target}`);
    }
  }
  assert.ok(signal instanceof AbortSignal);
});

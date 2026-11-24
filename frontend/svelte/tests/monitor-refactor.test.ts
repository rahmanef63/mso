import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPct, padSeries, pct, pushSample, sparklinePoints, SPAN,
} from "../src/lib/monitor/history.ts";
import {
  defaultDirection, matchesProcess, sortProcesses, summarize,
} from "../src/lib/monitor/process-view.ts";
import { LOG_LIMIT, readServiceLogs } from "../src/lib/monitor/services-logs-api.ts";
import {
  countByStatus, matchesService, serviceStatus, SERVICE_FILTERS,
} from "../src/lib/monitor/services-view.ts";
import { ApiError } from "../src/lib/host-api.ts";
import type { Process, SystemService } from "../../../lib/contracts/os-api";

const procs: Process[] = [
  { pid: 42, name: "mso", status: "S", cpu: 0.4, mem: 64 },
  { pid: 1234, name: "node", status: "R", cpu: 12.5, mem: 128 },
  { pid: 7, name: "Abc", status: "R", cpu: 0.4, mem: 16 },
];
const signal = new AbortController().signal;

test("clampPct and pct stay inside 0..100 and reject junk", () => {
  assert.equal(clampPct(-3), 0);
  assert.equal(clampPct(140), 100);
  assert.equal(clampPct(Number.NaN), 0);
  assert.equal(pct(1024, 2048), 50);
  assert.equal(pct(1, 0), 0);
  assert.equal(pct(Number.POSITIVE_INFINITY, 10), 0);
});

test("pushSample keeps a bounded rolling window and padSeries fills the front", () => {
  let series: number[] = [];
  for (let i = 1; i <= SPAN + 5; i++) series = pushSample(series, i % 101);
  assert.equal(series.length, SPAN);
  assert.equal(series[series.length - 1], (SPAN + 5) % 101);
  const padded = padSeries([10, 20]);
  assert.equal(padded.length, SPAN);
  assert.deepEqual(padded.slice(-2), [10, 20]);
  assert.equal(padded[0], 0);
});

test("sparklinePoints maps a percentage series onto an inverted SVG box", () => {
  const rows = sparklinePoints([0, 50, 100], 300, 48)
    .split(" ")
    .map((pair) => pair.split(",").map(Number));
  assert.equal(rows.length, SPAN);
  assert.deepEqual(rows[rows.length - 1], [300, 0]);
  assert.equal(rows[rows.length - 2][1], 24);
  assert.equal(rows[0][1], 48);
});

test("matchesProcess searches PID, name, and status", () => {
  const proc = procs[1];
  assert.equal(matchesProcess(proc, ""), true);
  assert.equal(matchesProcess(proc, "  "), true);
  assert.equal(matchesProcess(proc, "node"), true);
  assert.equal(matchesProcess(proc, "1234"), true);
  assert.equal(matchesProcess(proc, "r"), true);
  assert.equal(matchesProcess(proc, "zzz"), false);
});

test("sortProcesses honours key, direction, and a stable PID tiebreak", () => {
  assert.deepEqual(sortProcesses(procs, "cpu", "desc").map((p) => p.pid), [1234, 7, 42]);
  assert.deepEqual(sortProcesses(procs, "cpu", "asc").map((p) => p.pid), [7, 42, 1234]);
  assert.deepEqual(sortProcesses(procs, "mem", "desc").map((p) => p.pid), [1234, 42, 7]);
  assert.deepEqual(sortProcesses(procs, "pid", "asc").map((p) => p.pid), [7, 42, 1234]);
  assert.deepEqual(sortProcesses(procs, "name", "asc").map((p) => p.name), ["Abc", "mso", "node"]);
  assert.deepEqual(sortProcesses(procs, "name", "desc").map((p) => p.name), ["node", "mso", "Abc"]);
  assert.equal(defaultDirection("cpu"), "desc");
  assert.equal(defaultDirection("name"), "asc");
});

test("summarize reports totals, RSS MiB, and the hottest process", () => {
  const summary = summarize(procs);
  assert.equal(summary.total, 3);
  assert.equal(summary.totalRssMiB, 208);
  assert.equal(summary.topCpu?.pid, 1234);
  const empty = summarize([]);
  assert.deepEqual(empty, { total: 0, topCpu: null, totalRssMiB: 0 });
  assert.equal(summarize([{ pid: 1, name: "x", status: "R", cpu: 1, mem: -4 }]).totalRssMiB, 0);
});

test("readServiceLogs asks the bounded journal route and validates the DTO", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://127.0.0.1");
    assert.equal(url.pathname, "/api/v1/sys/services/logs");
    assert.equal(url.searchParams.get("scope"), "user");
    assert.equal(url.searchParams.get("unit"), "mso.service");
    assert.equal(url.searchParams.get("limit"), String(LOG_LIMIT));
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    return Response.json({
      unit: "mso.service", scope: "user", entries: ["a", "b"], available: true,
    });
  };
  const result = await readServiceLogs("user", "mso.service", signal, fetcher);
  assert.deepEqual(result.entries, ["a", "b"]);
  assert.equal(result.available, true);
});

test("readServiceLogs keeps the journal diagnostic and fails closed on bad input", async () => {
  const diagnostic = await readServiceLogs("system", "nginx.service", signal, async () => Response.json({
    unit: "nginx.service", scope: "system", entries: [], available: false, diagnostic: "journalctl missing",
  }));
  assert.equal(diagnostic.available, false);
  assert.equal(diagnostic.diagnostic, "journalctl missing");

  await assert.rejects(readServiceLogs("user", "not a unit", signal), (err: unknown) =>
    err instanceof ApiError && err.status === 400);
  await assert.rejects(
    readServiceLogs("user", "mso.service", signal, async () => Response.json({ unit: "mso.service" })),
    /journal response is invalid/,
  );
  await assert.rejects(
    readServiceLogs("user", "mso.service", signal, async () => new Response("nope", { status: 500, headers: { "content-type": "text/html" } })),
    /Service journal request failed \(500\)/,
  );
});

const services: SystemService[] = [
  { unit: "mso.service", scope: "user", load: "loaded", active: "active", sub: "running", description: "MSO control plane", controllable: true },
  { unit: "nginx.service", scope: "system", load: "loaded", active: "inactive", sub: "dead", description: "Web server", controllable: false },
  { unit: "broken.service", scope: "system", load: "loaded", active: "failed", sub: "failed", description: "Broken unit", controllable: true },
];

test("serviceStatus buckets active, inactive, and failed units", () => {
  assert.equal(serviceStatus(services[0]), "active");
  assert.equal(serviceStatus(services[1]), "inactive");
  assert.equal(serviceStatus(services[2]), "failed");
  assert.deepEqual(countByStatus(services), { all: 3, active: 1, inactive: 1, failed: 1 });
  assert.deepEqual(countByStatus([]), { all: 0, active: 0, inactive: 0, failed: 0 });
  assert.deepEqual(SERVICE_FILTERS.map((f) => f.id), ["all", "active", "inactive", "failed"]);
});

test("matchesService combines the status chip and the search box", () => {
  assert.equal(matchesService(services[0], "", "all"), true);
  assert.equal(matchesService(services[0], "mso", "active"), true);
  assert.equal(matchesService(services[0], "mso", "failed"), false);
  assert.equal(matchesService(services[1], "web", "inactive"), true);
  assert.equal(matchesService(services[2], "broken", "failed"), true);
  assert.equal(matchesService(services[2], "zzz", "all"), false);
});

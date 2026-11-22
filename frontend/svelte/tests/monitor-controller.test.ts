import { test } from "node:test";
import assert from "node:assert/strict";
import { createMonitor, type MonitorState } from "../src/lib/monitor-controller.ts";

const ready = { authenticated: true, deviceId: "fixture", deviceLabel: "Fixture", role: "owner" };
const signedOut = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
const stats = { cpu: { pct: 10, cores: 2 }, mem: { used: 1, total: 2 }, disk: { used: 1, total: 2 }, uptime: 1 };

test("signed-out probe never reads host metrics", async () => {
  const calls: string[] = [], states: MonitorState[] = [];
  const monitor = createMonitor((s) => states.push(s), async (path) => {
    calls.push(String(path)); return Response.json(signedOut);
  });
  await monitor.refresh();
  assert.deepEqual(calls, ["/api/auth/me"]);
  assert.deepEqual(states, [{ kind: "loading" }, { kind: "signed-out" }]);
  monitor.dispose();
});

test("authenticated probe reads stats once with no background polling", async () => {
  const calls: string[] = [], states: MonitorState[] = [];
  const monitor = createMonitor((s) => states.push(s), async (path) => {
    calls.push(String(path)); return Response.json(path === "/api/auth/me" ? ready : stats);
  });
  await monitor.refresh();
  assert.deepEqual(calls, ["/api/auth/me", "/api/v1/sys/stats"]);
  assert.equal(states.at(-1)?.kind, "ready");
  monitor.dispose();
});

test("new refresh aborts old request and ignores its late authenticated result", async () => {
  const states: MonitorState[] = [];
  let resolveFirst!: (value: Response) => void;
  let firstSignal: AbortSignal | null | undefined;
  let calls = 0;
  const monitor = createMonitor((s) => states.push(s), async (_path, init) => {
    calls++;
    if (calls === 1) {
      firstSignal = init?.signal;
      return new Promise<Response>((resolve) => { resolveFirst = resolve; });
    }
    return Response.json(signedOut);
  });
  const old = monitor.refresh();
  await monitor.refresh();
  resolveFirst(Response.json(ready));
  await old;
  assert.equal(firstSignal?.aborted, true);
  assert.equal(calls, 2);
  assert.deepEqual(states.at(-1), { kind: "signed-out" });
  monitor.dispose();
});

test("dispose prevents late data and all subsequent requests", async () => {
  const states: MonitorState[] = [];
  let resolve!: (value: Response) => void;
  let calls = 0;
  const monitor = createMonitor((s) => states.push(s), async () => {
    calls++; return new Promise<Response>((done) => { resolve = done; });
  });
  const pending = monitor.refresh();
  monitor.dispose();
  resolve(Response.json(ready));
  await pending;
  await monitor.refresh();
  assert.equal(calls, 1);
  assert.deepEqual(states, [{ kind: "loading" }]);
});

test("revoked session clears metrics and retry can recover", async () => {
  const states: MonitorState[] = [];
  let refuse = true;
  const monitor = createMonitor((s) => states.push(s), async (path) => {
    if (path === "/api/auth/me") return Response.json(ready);
    return refuse ? Response.json({}, { status: 401 }) : Response.json(stats);
  });
  await monitor.refresh();
  assert.equal(states.at(-1)?.kind, "error");
  refuse = false;
  await monitor.refresh();
  assert.equal(states.at(-1)?.kind, "ready");
  monitor.dispose();
});

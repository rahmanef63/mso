import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, createProcessesController, readProcesses, type Process, type ProcessesState,
} from "../src/lib/monitor/processes-api.ts";
const sample: Process[] = [
  { pid: 1234, name: "node", status: "R", cpu: 12.5, mem: 128 },
  { pid: 42, name: "mso", status: "S", cpu: 0.4, mem: 64 },
];
const signal = new AbortController().signal;
const jsonOf = (body: unknown): typeof fetch => async () => ({
  ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
  json: async () => body,
} as Response);

test("readProcesses fetches relative same-origin uncached JSON and parses DTO", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/v1/sys/processes");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.equal((init?.headers as Record<string, string>)?.Accept, "application/json");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json(sample);
  };
  assert.deepEqual(await readProcesses(signal, fetcher), sample);
});

test("readProcesses uses shell bridge origin with credentials include", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/sys/processes");
    assert.equal(init?.credentials, "include");
    return Response.json([]);
  };
  assert.deepEqual(await readProcesses(signal, fetcher, bridge), []);
});

test("malformed process payloads fail closed", async () => {
  const bad: unknown[] = [
    null, {}, [null],
    [{ pid: -1, name: "node", status: "R", cpu: 1, mem: 10 }],
    [{ pid: 0, name: "node", status: "R", cpu: 1, mem: 10 }],
    [{ pid: 1.5, name: "node", status: "R", cpu: 1, mem: 10 }],
    [{ pid: 10, name: "   ", status: "R", cpu: 1, mem: 10 }],
    [{ pid: 10, name: "node", status: 1, cpu: 1, mem: 10 }],
    [{ pid: 10, name: "node", status: "R", cpu: Number.NaN, mem: 10 }],
    [{ pid: 10, name: "node", status: "R", cpu: Number.POSITIVE_INFINITY, mem: 10 }],
    [{ pid: 10, name: "node", status: "R", cpu: -0.1, mem: 10 }],
    [{ pid: 10, name: "node", status: "R", cpu: 1, mem: -5 }],
  ];
  for (const payload of bad) {
    await assert.rejects(readProcesses(signal, jsonOf(payload)), /process inventory response is invalid/);
  }
});

test("HTML fallback is rejected as unavailable API", async () => {
  await assert.rejects(
    readProcesses(signal, async () => new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } })),
    (err: unknown) => err instanceof ApiError && err.status === 502 && /API is unavailable/.test(err.message),
  );
});

test("401, 403, 429 and 500 map cleanly without leaking upstream body", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      readProcesses(signal, async () => Response.json({ error: "secret upstream trace" }, { status })),
      (err: unknown) => err instanceof ApiError && err.status === status
        && !err.message.includes("secret upstream trace")
        && (status === 429 ? /Too many requests/.test(err.message) : true),
    );
  }
});

test("controller refresh aborts superseded request and ignores late resolution", async () => {
  const states: ProcessesState[] = [];
  let resolveFirst!: (value: Response) => void;
  let firstSignal: AbortSignal | null | undefined;
  let calls = 0;
  const ctrl = createProcessesController((s) => states.push(s), async (_url, init) => {
    calls++;
    if (calls === 1) { firstSignal = init?.signal; return new Promise<Response>((r) => { resolveFirst = r; }); }
    return Response.json([sample[1]]);
  });
  const first = ctrl.refresh();
  await ctrl.refresh();
  resolveFirst(Response.json(sample));
  await first;
  assert.equal(firstSignal?.aborted, true);
  assert.equal(calls, 2);
  assert.deepEqual(states.at(-1), { kind: "ready", processes: [sample[1]] });
  ctrl.dispose();
});

test("controller dispose suppresses late data and blocks further refreshes", async () => {
  const states: ProcessesState[] = [];
  let resolve!: (value: Response) => void;
  let calls = 0;
  const ctrl = createProcessesController((s) => states.push(s), async () => {
    calls++; return new Promise<Response>((done) => { resolve = done; });
  });
  const pending = ctrl.refresh();
  ctrl.dispose();
  resolve(Response.json(sample));
  await pending;
  await ctrl.refresh();
  assert.equal(calls, 1);
  assert.deepEqual(states, [{ kind: "loading" }]);
});

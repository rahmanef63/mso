import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, readSession, readStats } from "../src/lib/host-api.ts";
import { bytes, uptime } from "../src/lib/format.ts";

const session = { authenticated: true, deviceId: "fixture-device", deviceLabel: "Fixture", role: "viewer" };
const stats = { cpu: { pct: 12, cores: 4 }, mem: { used: 1024, total: 4096 }, disk: { used: 2048, total: 8192 }, uptime: 90_000 };
const signal = new AbortController().signal;
const answer = (body: unknown): typeof fetch => async () => Response.json(body);

test("session probe is relative, same-origin, uncached and abortable", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/auth/me");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.method, "GET");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json(session);
  };
  assert.deepEqual(await readSession(signal, fetcher), session);
});

test("signed-out response preserves null identity", async () => {
  const empty = { authenticated: false, deviceId: null, deviceLabel: null, role: null };
  assert.deepEqual(await readSession(signal, answer(empty)), empty);
});

test("session shape and role fail closed", async () => {
  for (const body of [null, {}, { ...session, role: "admin" }, { ...session, deviceId: null }, { ...session, authenticated: false }]) {
    await assert.rejects(readSession(signal, answer(body)), /session response is invalid/);
  }
});

test("HTML fallback is unavailable, not an authenticated API", async () => {
  await assert.rejects(readSession(signal, async () => new Response("<html>fallback</html>", {
    headers: { "Content-Type": "text/html" },
  })), /API is unavailable/);
});

test("auth refusal is distinct and server error bodies are not displayed", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(readStats(signal, async () => Response.json({ error: "private upstream detail" }, { status })),
      (error: unknown) => error instanceof ApiError && error.status === status && !error.message.includes("private upstream"));
  }
});

test("valid metrics use shared host DTO units", async () => {
  assert.deepEqual(await readStats(signal, answer(stats)), stats);
  assert.equal(bytes(1024), "1.0 KiB");
  assert.equal(bytes(1024 ** 3), "1.0 GiB");
  assert.equal(uptime(90_000), "0d 0h 1m");
});

test("malformed or impossible numeric readings are rejected", async () => {
  for (const body of [null, {}, { ...stats, cpu: { pct: 101, cores: 4 } },
    { ...stats, cpu: { pct: 1, cores: 0 } }, { ...stats, mem: { used: -1, total: 4 } },
    { ...stats, uptime: "90000" }]) {
    await assert.rejects(readStats(signal, answer(body)), /stats response is invalid/);
  }
});

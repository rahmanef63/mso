import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, copyFsEntry, moveFsEntry, searchFs, validateFsPath,
} from "../src/lib/files/files-ops-api.ts";
import {
  createAuditLogController, createSoftwareUpdateController, readAuditLog, readSoftwareUpdate,
  type AuditLogState, type SoftwareUpdateState, type SoftwareUpdateStatus,
} from "../src/lib/settings/host-ops-api.ts";

const signal = new AbortController().signal;
const bridge = { surface: "tauri-desktop" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
const jsonOf = (body: unknown, status = 200): typeof fetch => async () =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);
const htmlOf = (status = 200): typeof fetch => async () =>
  new Response("<html>login</html>", { status, headers: { "content-type": "text/html" } });
const badJsonOf = (): typeof fetch => async () =>
  new Response("{bad-json", { status: 200, headers: { "content-type": "application/json" } });

const sampleUpdate: SoftwareUpdateStatus = {
  supported: true, reason: null, current: "abc1234", currentSubject: "feat: hybrid shell",
  latest: "def5678", buildSha: "abc1234", pendingBuild: false, ahead: 0, behind: 2,
  commits: [{ sha: "def5678", subject: "fix: audit log", date: "2026-11-22" }],
  dirty: false, running: false, remoteChecked: true, log: "", channel: "stable",
  target: "v1.4.0", targetFallback: false,
  conflict: { conflicted: [], carried: ["README.md"], overlap: [], safe: true, detail: "clean" },
};

test("copyFsEntry and moveFsEntry validate paths, send bridge creds, and map errors safely", async () => {
  const calls: Array<{ url: string; method?: string; creds?: RequestCredentials; body: unknown }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.cache, "no-store");
    assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
    calls.push({ url: String(input), method: init?.method, creds: init?.credentials, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true });
  };
  await copyFsEntry("/srv/a.txt", "/srv/b.txt", signal, fetcher);
  await moveFsEntry("/srv/b.txt", "/srv/c.txt", signal, fetcher, bridge);
  assert.deepEqual(calls, [
    { url: "/api/v1/fs/copy", method: "POST", creds: "same-origin", body: { from: "/srv/a.txt", to: "/srv/b.txt" } },
    { url: "http://127.0.0.1:4173/api/v1/fs/move", method: "POST", creds: "include", body: { from: "/srv/b.txt", to: "/srv/c.txt" } },
  ]);

  assert.equal(validateFsPath(" /srv/docs "), "/srv/docs");
  for (const [from, to] of [
    ["", "/srv/b"], ["/srv/a", "   "], ["/srv/../etc/passwd", "/srv/b"],
    ["/srv/a", "/srv/b\0c"], ["/srv/same", "/srv/same/"], ["/srv/dir", "/srv/dir/sub"],
  ]) {
    await assert.rejects(copyFsEntry(from, to, signal, jsonOf({ ok: true })), (e: unknown) => e instanceof ApiError && e.status === 400);
    await assert.rejects(moveFsEntry(from, to, signal, jsonOf({ ok: true })), (e: unknown) => e instanceof ApiError && e.status === 400);
  }

  await assert.rejects(copyFsEntry("/srv/a", "/srv/b", signal, jsonOf({ ok: false })), (e: unknown) => e instanceof ApiError && e.status === 502);
  await assert.rejects(moveFsEntry("/srv/a", "/srv/b", signal, htmlOf(200)), (e: unknown) => e instanceof ApiError && e.status === 502);
  await assert.rejects(copyFsEntry("/srv/a", "/srv/b", signal, badJsonOf()), (e: unknown) => e instanceof ApiError && e.status === 502);
  for (const status of [401, 403, 404, 409, 429, 500]) {
    await assert.rejects(
      moveFsEntry("/srv/a", "/srv/b", signal, jsonOf({ error: "secret host stack" }, status)),
      (e: unknown) => e instanceof ApiError && e.status === status && !e.message.includes("secret host stack"),
    );
  }
});

test("searchFs encodes q and optional dir as root, short-circuits empty query, and fails closed", async () => {
  const seen: Array<{ url: string; creds?: RequestCredentials }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method, "GET");
    seen.push({ url: String(input), creds: init?.credentials });
    return Response.json([{ name: "mso", path: "/srv/projects/mso", kind: "dir" }]);
  };
  assert.deepEqual(await searchFs("   ", undefined, signal, fetcher), []);
  assert.equal(seen.length, 0);

  const hitsA = await searchFs("mso", undefined, signal, fetcher);
  const hitsB = await searchFs("mso", "/srv/projects", signal, fetcher, bridge);
  assert.deepEqual(hitsA, [{ name: "mso", path: "/srv/projects/mso", kind: "dir" }]);
  assert.deepEqual(hitsB, [{ name: "mso", path: "/srv/projects/mso", kind: "dir" }]);
  assert.deepEqual(seen, [
    { url: "/api/v1/fs/search?q=mso", creds: "same-origin" },
    { url: "http://127.0.0.1:4173/api/v1/fs/search?q=mso&root=%2Fsrv%2Fprojects", creds: "include" },
  ]);

  await assert.rejects(searchFs("a\0b", undefined, signal, fetcher), (e: unknown) => e instanceof ApiError && e.status === 400);
  await assert.rejects(searchFs("mso", "/srv/../etc", signal, fetcher), (e: unknown) => e instanceof ApiError && e.status === 400);
  for (const bad of [null, {}, [{ name: "", path: "/x", kind: "dir" }], [{ name: "x", path: "/x", kind: "symlink" }]]) {
    await assert.rejects(searchFs("mso", undefined, signal, jsonOf(bad)), (e: unknown) => e instanceof ApiError && e.status === 502);
  }
  await assert.rejects(searchFs("mso", undefined, signal, htmlOf(200)), (e: unknown) => e instanceof ApiError && e.status === 502);
  for (const status of [401, 403, 404, 429]) {
    await assert.rejects(
      searchFs("mso", undefined, signal, jsonOf({ error: "raw-leak" }, status)),
      (e: unknown) => e instanceof ApiError && e.status === status && !e.message.includes("raw-leak"),
    );
  }
});

test("readSoftwareUpdate validates UpdateStatus DTO, bridge creds, and safe error mapping", async () => {
  const status = await readSoftwareUpdate(signal, async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:4173/api/v1/sys/update");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    return Response.json(sampleUpdate);
  }, bridge);
  assert.deepEqual(status, sampleUpdate);

  const malformed: unknown[] = [
    null, [], {}, { ...sampleUpdate, behind: -1 }, { ...sampleUpdate, channel: "nightly" },
    { ...sampleUpdate, commits: [{ sha: "", subject: "x", date: "2026-11-22" }] },
    { ...sampleUpdate, conflict: { conflicted: [1], carried: [], overlap: [], safe: true, detail: "" } },
  ];
  for (const body of malformed) {
    await assert.rejects(readSoftwareUpdate(signal, jsonOf(body)), (e: unknown) => e instanceof ApiError && e.status === 502);
  }
  await assert.rejects(readSoftwareUpdate(signal, htmlOf(200)), (e: unknown) => e instanceof ApiError && e.status === 502);
  await assert.rejects(readSoftwareUpdate(signal, badJsonOf()), (e: unknown) => e instanceof ApiError && e.status === 502);
  for (const code of [401, 403, 429, 500]) {
    await assert.rejects(
      readSoftwareUpdate(signal, jsonOf({ error: "internal-git-token" }, code)),
      (e: unknown) => e instanceof ApiError && e.status === code && !e.message.includes("internal-git-token"),
    );
  }
});

test("readAuditLog validates AuditEntry list, query params, and error handling", async () => {
  const seen: string[] = [];
  const entries = await readAuditLog(signal, async (input, init) => {
    seen.push(String(input));
    assert.equal(init?.credentials, "same-origin");
    return Response.json({
      entries: [
        { ts: "2026-11-22T09:00:00.000Z", action: "fs.copy", actor: "dev-1", target: "/a -> /b", ok: true, meta: { bytes: 12 } },
        { action: "sys.update", actor: null, ip: null, ok: false, detail: "dirty tree" },
      ],
    });
  }, undefined, { limit: 25, prefix: "fs.", actor: "dev-" });
  assert.equal(seen[0], "/api/v1/sys/audit?limit=25&prefix=fs.&actor=dev-");
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.action, "fs.copy");

  await assert.rejects(readAuditLog(signal, jsonOf({ entries: [] }), undefined, { limit: 0 }), (e: unknown) => e instanceof ApiError && e.status === 400);
  for (const bad of [null, {}, { entries: "nope" }, { entries: [{ action: "" }] }, { entries: [{ action: "a", meta: { nested: {} } }] }]) {
    await assert.rejects(readAuditLog(signal, jsonOf(bad)), (e: unknown) => e instanceof ApiError && e.status === 502);
  }
  await assert.rejects(readAuditLog(signal, htmlOf(200)), (e: unknown) => e instanceof ApiError && e.status === 502);
  await assert.rejects(readAuditLog(signal, badJsonOf()), (e: unknown) => e instanceof ApiError && e.status === 502);
  for (const code of [401, 403, 429]) {
    await assert.rejects(
      readAuditLog(signal, jsonOf({ error: "audit-secret" }, code)),
      (e: unknown) => e instanceof ApiError && e.status === code && !e.message.includes("audit-secret"),
    );
  }
});

test("update and audit controllers handle transitions, errors, stale races, and dispose", async () => {
  const updStates: SoftwareUpdateState[] = [];
  let resolveSlow!: (res: Response) => void;
  let slowSig: AbortSignal | null | undefined;
  let updCalls = 0;
  const updCtrl = createSoftwareUpdateController((s) => updStates.push(s), async (_u, init) => {
    updCalls++;
    if (updCalls === 1) return Response.json(sampleUpdate);
    if (updCalls === 2) return Response.json({ error: "denied" }, { status: 403 });
    slowSig = init?.signal;
    return new Promise<Response>((r) => { resolveSlow = r; });
  });
  await updCtrl.refresh();
  assert.equal(updStates.at(-1)?.kind, "ready");
  await updCtrl.refresh();
  assert.equal(updStates.at(-1)?.kind, "error");
  const pendingUpd = updCtrl.refresh();
  updCtrl.dispose();
  resolveSlow(Response.json(sampleUpdate));
  await pendingUpd;
  await updCtrl.refresh();
  assert.equal(slowSig?.aborted, true);
  assert.equal(updCalls, 3);
  assert.equal(updStates.at(-1)?.kind, "loading");

  const auditStates: AuditLogState[] = [];
  let resolveFirst!: (res: Response) => void;
  let auditCalls = 0;
  const auditCtrl = createAuditLogController((s) => auditStates.push(s), async () => {
    auditCalls++;
    if (auditCalls === 1) return new Promise<Response>((r) => { resolveFirst = r; });
    return Response.json({ entries: [{ action: "sys.audit", ok: true }] });
  });
  const first = auditCtrl.refresh({ limit: 10 });
  const second = auditCtrl.refresh({ limit: 20 });
  await second;
  resolveFirst(Response.json({ entries: [{ action: "stale.event", ok: false }] }));
  await first;
  const finalAudit = auditStates.at(-1);
  assert.equal(finalAudit?.kind, "ready");
  assert.equal(finalAudit.entries[0]?.action, "sys.audit");
  auditCtrl.dispose();
});

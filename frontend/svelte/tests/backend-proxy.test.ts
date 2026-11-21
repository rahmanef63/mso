import { test } from "node:test";
import assert from "node:assert/strict";
import { localReadProxy } from "../tooling/backend-proxy.mjs";

test("no backend configured means no proxy", () => {
  assert.equal(localReadProxy(undefined), undefined);
});

test("only explicit loopback origins are accepted", () => {
  for (const origin of ["http://127.0.0.1:4005", "https://localhost:4005", "http://[::1]:4005"]) {
    assert.equal(Object.keys(localReadProxy(origin)!).length, 31);
  }
  for (const origin of ["https://mso.example.com", "http://localhost.evil.test", "http://user:pass@localhost:4005",
    "http://localhost/path", "http://localhost/?x=1", "file:///etc/passwd", "http://localhost/#fragment"]) {
    assert.throws(() => localReadProxy(origin));
  }
});

test("proxy allowlist matches exact Increments 1-4B paths, not siblings or exec", () => {
  const proxy = localReadProxy("http://localhost:4005");
  assert.ok(proxy);
  const patterns = Object.keys(proxy).map((p) => new RegExp(p));
  for (const path of [
    "/api/auth/me", "/api/auth/login", "/api/auth/logout", "/api/auth/devices",
    "/api/assistant", "/api/changelog", "/api/memory", "/api/models", "/api/prefs", "/api/skills", "/api/threads",
    "/api/v1/channels", "/api/v1/integrations?action=catalog", "/api/v1/managed-apps",
    "/api/v1/memory-graph", "/api/v1/organization", "/api/v1/workflows?runs=1",
    "/api/v1/sys/stats", "/api/v1/sys/processes", "/api/v1/sys/services", "/api/v1/sys/packages",
    "/api/v1/fs/list?path=~", "/api/v1/fs/read?path=~/a", "/api/v1/fs/write", "/api/v1/fs/mkdir", "/api/v1/fs/delete",
    "/api/v1/term/open", "/api/v1/term/stream?id=t1", "/api/v1/term/input", "/api/v1/term/resize", "/api/v1/term/close",
  ]) {
    assert.equal(patterns.some((p) => p.test(path)), true, path);
  }
  for (const path of ["/api/auth/me/secret", "/api/changelog/raw", "/api/config", "/api/v1/exec/run", "/api/v1/editor/exec"]) {
    assert.equal(patterns.some((p) => p.test(path)), false, path);
  }
});

test("route methods and CSRF depth-2 are enforced before proxying", () => {
  const proxy = localReadProxy("http://localhost:4005")!;
  const makeRes = () => {
    const rec = { status: 0, ended: false };
    return { rec, res: { writeHead: (s: number) => { rec.status = s; }, end: () => { rec.ended = true; } } };
  };

  const wfRoute = proxy["^/api/v1/workflows(?:\\?|$)"];
  assert.equal(wfRoute.changeOrigin, false);
  const r1 = makeRes();
  assert.equal(wfRoute.bypass({ method: "DELETE", headers: {} }, r1.res), false);
  assert.equal(r1.rec.status, 405);
  const r2 = makeRes();
  assert.equal(wfRoute.bypass({ method: "POST", headers: { "sec-fetch-site": "cross-site" } }, r2.res), false);
  assert.equal(r2.rec.status, 403);
  const r3 = makeRes();
  assert.equal(wfRoute.bypass({ method: "POST", headers: { "sec-fetch-site": "same-origin" } }, r3.res), undefined);

  const changelogRoute = proxy["^/api/changelog(?:\\?|$)"];
  const r4 = makeRes();
  assert.equal(changelogRoute.bypass({ method: "POST", headers: { "sec-fetch-site": "same-origin" } }, r4.res), false);
  assert.equal(r4.rec.status, 405);
});

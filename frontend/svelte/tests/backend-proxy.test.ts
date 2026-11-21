import { test } from "node:test";
import assert from "node:assert/strict";
import { localReadProxy } from "../tooling/backend-proxy.mjs";

test("no backend configured means no proxy", () => {
  assert.equal(localReadProxy(undefined), undefined);
});

test("only explicit loopback origins are accepted", () => {
  for (const origin of ["http://127.0.0.1:4005", "https://localhost:4005", "http://[::1]:4005"]) {
    assert.equal(Object.keys(localReadProxy(origin)!).length, 17);
  }
  for (const origin of ["https://mso.example.com", "http://localhost.evil.test", "http://user:pass@localhost:4005",
    "http://localhost/path", "http://localhost/?x=1", "file:///etc/passwd", "http://localhost/#fragment"]) {
    assert.throws(() => localReadProxy(origin));
  }
});

test("proxy allowlist matches exact Increment 2A/3A/3B paths, not siblings or exec", () => {
  const proxy = localReadProxy("http://localhost:4005");
  assert.ok(proxy);
  const patterns = Object.keys(proxy).map((p) => new RegExp(p));
  for (const path of [
    "/api/auth/me", "/api/auth/login", "/api/auth/logout", "/api/auth/devices",
    "/api/v1/sys/stats", "/api/v1/sys/processes", "/api/v1/sys/services",
    "/api/v1/fs/list?path=~", "/api/v1/fs/read?path=~/a", "/api/v1/fs/write",
    "/api/v1/fs/mkdir", "/api/v1/fs/delete", "/api/v1/term/open",
    "/api/v1/term/stream?id=t1", "/api/v1/term/input", "/api/v1/term/resize", "/api/v1/term/close",
  ]) {
    assert.equal(patterns.some((p) => p.test(path)), true, path);
  }
  for (const path of ["/api/auth/me/secret", "/api/auth/me-other", "/api/v1/sys/stats-extra", "/api/config", "/api/v1/exec/run"]) {
    assert.equal(patterns.some((p) => p.test(path)), false, path);
  }
});

test("route methods and CSRF depth-2 are enforced before proxying", () => {
  const proxy = localReadProxy("http://localhost:4005")!;
  const makeRes = () => {
    const rec = { status: 0, ended: false };
    return { rec, res: { writeHead: (s: number) => { rec.status = s; }, end: () => { rec.ended = true; } } };
  };

  const statsRoute = proxy["^/api/v1/sys/stats(?:\\?|$)"];
  assert.equal(statsRoute.changeOrigin, false);
  const r1 = makeRes();
  assert.equal(statsRoute.bypass({ method: "POST", headers: { "sec-fetch-site": "same-origin" } }, r1.res), false);
  assert.equal(r1.rec.status, 405);
  assert.equal(statsRoute.bypass({ method: "GET", headers: {} }, r1.res), undefined);

  const delRoute = proxy["^/api/v1/fs/delete(?:\\?|$)"];
  const r2 = makeRes();
  assert.equal(delRoute.bypass({ method: "POST", headers: { "sec-fetch-site": "same-origin" } }, r2.res), false);
  assert.equal(r2.rec.status, 405);
  const r3 = makeRes();
  assert.equal(delRoute.bypass({ method: "DELETE", headers: { "sec-fetch-site": "cross-site" } }, r3.res), false);
  assert.equal(r3.rec.status, 403);
  const r4 = makeRes();
  assert.equal(delRoute.bypass({ method: "DELETE", headers: { "sec-fetch-site": "same-origin" } }, r4.res), undefined);
});

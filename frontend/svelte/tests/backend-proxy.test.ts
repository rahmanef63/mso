import { test } from "node:test";
import assert from "node:assert/strict";
import { localReadProxy } from "../tooling/backend-proxy.mjs";

test("no backend configured means no proxy", () => {
  assert.equal(localReadProxy(undefined), undefined);
});

test("only explicit loopback origins are accepted", () => {
  for (const origin of ["http://127.0.0.1:4005", "https://localhost:4005", "http://[::1]:4005"]) {
    assert.equal(Object.keys(localReadProxy(origin)!).length, 2);
  }
  for (const origin of ["https://mso.example.com", "http://localhost.evil.test", "http://user:pass@localhost:4005",
    "http://localhost/path", "http://localhost/?x=1", "file:///etc/passwd", "http://localhost/#fragment"]) {
    assert.throws(() => localReadProxy(origin));
  }
});

test("proxy allowlist matches exact read paths, not siblings or host operations", () => {
  const proxy = localReadProxy("http://localhost:4005");
  assert.ok(proxy);
  const patterns = Object.keys(proxy).map((p) => new RegExp(p));
  for (const path of ["/api/auth/me", "/api/v1/sys/stats", "/api/v1/sys/stats?fresh=1"]) {
    assert.equal(patterns.some((p) => p.test(path)), true, path);
  }
  for (const path of ["/api/auth/me/secret", "/api/auth/me-other", "/api/v1/sys/stats-extra", "/api/config", "/api/v1/exec/run"]) {
    assert.equal(patterns.some((p) => p.test(path)), false, path);
  }
});

test("mutating methods are refused before proxying", () => {
  for (const config of Object.values(localReadProxy("http://localhost:4005")!)) {
    assert.equal(config.changeOrigin, false);
    let status = 0, ended = false;
    const response = { writeHead: (value: number) => { status = value; }, end: () => { ended = true; } };
    assert.equal(config.bypass({ method: "POST" }, response), false);
    assert.equal(status, 405);
    assert.equal(ended, true);
    assert.equal(config.bypass({ method: "GET" }, response), undefined);
  }
});

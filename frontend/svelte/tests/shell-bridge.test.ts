import { test } from "node:test";
import assert from "node:assert/strict";
import { detectShellBridge, parseHostOrigin, resolveApiUrl } from "../src/lib/shell-bridge.ts";

test("parseHostOrigin accepts HTTPS remote hosts and loopback HTTP(S) only", () => {
  assert.equal(parseHostOrigin("https://mso.example.com"), "https://mso.example.com");
  assert.equal(parseHostOrigin("https://mso.example.com:8443/"), "https://mso.example.com:8443");
  assert.equal(parseHostOrigin("http://127.0.0.1:4005"), "http://127.0.0.1:4005");
  assert.equal(parseHostOrigin("http://localhost:4005/"), "http://localhost:4005");
  assert.equal(parseHostOrigin("http://[::1]:4005"), "http://[::1]:4005");
});

test("parseHostOrigin rejects plaintext remote HTTP, credentials, paths and non-HTTP schemes", () => {
  for (const bad of [
    "",
    "http://mso.example.com",
    "http://10.0.0.5:4005",
    "https://user:pass@mso.example.com",
    "https://mso.example.com/api",
    "https://mso.example.com/?x=1",
    "https://mso.example.com/#frag",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    assert.equal(parseHostOrigin(bad), null, `expected rejection for ${bad}`);
  }
});

test("detectShellBridge defaults to same-origin web and fails closed on invalid injected origins", () => {
  assert.deepEqual(detectShellBridge({}), { surface: "web", apiBaseOrigin: null });
  assert.deepEqual(detectShellBridge({ __TAURI_INTERNALS__: {} }), { surface: "tauri-desktop", apiBaseOrigin: null });
  assert.deepEqual(
    detectShellBridge({ __MSO_SHELL__: { surface: "rust-host", apiBaseOrigin: "http://127.0.0.1:4005" } }),
    { surface: "rust-host", apiBaseOrigin: "http://127.0.0.1:4005" },
  );
  assert.deepEqual(
    detectShellBridge({ __MSO_SHELL__: { surface: "tauri-desktop", apiBaseOrigin: "http://mso.example.com" } }),
    { surface: "web", apiBaseOrigin: null },
  );
});

test("resolveApiUrl keeps relative paths on web and blocks non-api or scheme-injected paths", () => {
  assert.equal(resolveApiUrl("/api/auth/me", { surface: "web", apiBaseOrigin: null }), "/api/auth/me");
  assert.equal(
    resolveApiUrl("/api/v1/sys/stats", { surface: "tauri-desktop", apiBaseOrigin: "https://mso.example.com" }),
    "https://mso.example.com/api/v1/sys/stats",
  );
  for (const bad of ["/etc/passwd", "//evil.example/api/auth/me", "https://evil.example/api/auth/me"]) {
    assert.throws(() => resolveApiUrl(bad, { surface: "web", apiBaseOrigin: null }));
  }
});

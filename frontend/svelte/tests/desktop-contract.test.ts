import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { detectShellBridge, resolveApiUrl } from "../src/lib/shell-bridge.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const TAURI_DIR = resolve(REPO_ROOT, "rust-shell/desktop-tauri");

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

function extractInitScriptTemplate(mainRs: string): string {
  const fnStart = mainRs.indexOf("fn build_initialization_script");
  assert.notEqual(fnStart, -1, "main.rs must define build_initialization_script");
  const slice = mainRs.slice(fnStart);
  const match = slice.match(/r#"([\s\S]*?)"#/);
  if (!match?.[1]) {
    throw new Error("build_initialization_script must contain raw JS template");
  }
  return match[1].replaceAll("{{", "{").replaceAll("}}", "}");
}

function runInjectedScript(
  template: string,
  bootstrap: Record<string, string>,
  location: { protocol: string; hostname: string },
): Record<string, unknown> {
  const script = template.replace("{bootstrap_json}", JSON.stringify(bootstrap));
  const win: Record<string, unknown> = { location };
  vm.runInNewContext(script, { window: win, Object });
  return win;
}

function parseCspDirectives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      map.set(tokens[0].toLowerCase(), tokens.slice(1));
    }
  }
  return map;
}

test("desktop init script in main.rs matches shell-bridge.ts and core bootstrap shape", () => {
  const mainRs = readRepoFile("rust-shell/desktop-tauri/src/main.rs");
  const desktopRs = readRepoFile("rust-shell/crates/mso-shell-core/src/desktop.rs");
  const template = extractInitScriptTemplate(mainRs);

  assert.match(mainRs, /\bmod profiles;/);
  assert.match(mainRs, /generate_handler!\[\s*resolve_deep_link\s*,\s*list_host_profiles_json\s*,?\s*\]/);
  assert.match(
    desktopRs,
    /"mode":"tauri-desktop","apiBaseOrigin":"\{\}","profileId":"\{\}","shellVersion":"\{\}"/,
  );

  const cases = [
    {
      label: "local loopback on tauri bundled origin",
      location: { protocol: "tauri:", hostname: "tauri.localhost" },
      bootstrap: {
        mode: "tauri-desktop",
        apiBaseOrigin: "http://127.0.0.1:4005",
        profileId: "local-default",
        shellVersion: "0.1.0",
      },
    },
    {
      label: "remote HTTPS on loopback dev origin",
      location: { protocol: "http:", hostname: "127.0.0.1" },
      bootstrap: {
        mode: "tauri-desktop",
        apiBaseOrigin: "https://mso.example.com:8443",
        profileId: "remote-env",
        shellVersion: "0.1.0",
      },
    },
  ];

  for (const item of cases) {
    const win = runInjectedScript(template, item.bootstrap, item.location);
    assert.deepEqual(
      { ...(win.__MSO_DESKTOP_SHELL__ as Record<string, unknown>) },
      item.bootstrap,
      item.label,
    );
    assert.equal(Object.isFrozen(win.__MSO_DESKTOP_SHELL__), true);
    assert.equal(Object.isFrozen(win.__MSO_SHELL__), true);
    const shellDesc = Object.getOwnPropertyDescriptor(win, "__MSO_SHELL__");
    assert.equal(shellDesc?.writable, false);
    assert.equal(shellDesc?.configurable, false);

    const bridge = detectShellBridge(win);
    assert.deepEqual(bridge, {
      surface: "tauri-desktop",
      apiBaseOrigin: item.bootstrap.apiBaseOrigin,
    });
    assert.equal(
      resolveApiUrl("/api/v1/sys/stats", bridge),
      `${item.bootstrap.apiBaseOrigin}/api/v1/sys/stats`,
    );
  }

  const untrustedWin = runInjectedScript(
    template,
    {
      mode: "tauri-desktop",
      apiBaseOrigin: "https://mso.example.com",
      profileId: "remote-env",
      shellVersion: "0.1.0",
    },
    { protocol: "https:", hostname: "untrusted.example.com" },
  );
  assert.equal("__MSO_DESKTOP_SHELL__" in untrustedWin, false);
  assert.equal("__MSO_SHELL__" in untrustedWin, false);
  assert.deepEqual(detectShellBridge(untrustedWin), { surface: "web", apiBaseOrigin: null });

  const tamperedWin = runInjectedScript(
    template,
    {
      mode: "tauri-desktop",
      apiBaseOrigin: "http://mso.example.com",
      profileId: "tampered",
      shellVersion: "0.1.0",
    },
    { protocol: "tauri:", hostname: "tauri.localhost" },
  );
  const tamperedBridge = detectShellBridge(tamperedWin);
  assert.deepEqual(tamperedBridge, { surface: "web", apiBaseOrigin: null });
  assert.equal(resolveApiUrl("/api/auth/me", tamperedBridge), "/api/auth/me");
});

test("tauri.conf.json enforces Svelte frontendDist, default capability, strict CSP, and mso scheme", () => {
  const conf = JSON.parse(readFileSync(resolve(TAURI_DIR, "tauri.conf.json"), "utf8"));
  assert.equal(conf.build?.frontendDist, "../../frontend/svelte/build");
  assert.deepEqual(conf.app?.security?.capabilities, ["default"]);
  assert.deepEqual(conf.plugins?.["deep-link"]?.desktop?.schemes, ["mso"]);

  const csp = String(conf.app?.security?.csp ?? "");
  assert.ok(csp.length > 0, "CSP must be configured");
  assert.equal(csp.toLowerCase().includes("unsafe-eval"), false, "CSP must forbid unsafe-eval");

  const directives = parseCspDirectives(csp);
  const scriptSrc = directives.get("script-src") ?? [];
  assert.equal(scriptSrc.includes("'unsafe-inline'"), false);
  assert.equal(scriptSrc.includes("*"), false);

  const connectSrc = directives.get("connect-src") ?? [];
  assert.ok(connectSrc.length > 0, "connect-src must be declared");
  for (const forbidden of ["*", "http://*", "https://*", "ws://*", "wss://*", "http:", "ws:"]) {
    assert.equal(connectSrc.includes(forbidden), false, `connect-src must forbid ${forbidden}`);
  }
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), ["'none'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
});

test("capabilities/default.json grants only core:default with no wildcard permissions", () => {
  const cap = JSON.parse(readFileSync(resolve(TAURI_DIR, "capabilities/default.json"), "utf8"));
  assert.equal(cap.identifier, "default");
  assert.deepEqual(cap.windows, ["main"]);
  assert.deepEqual(cap.permissions, ["core:default"]);
  for (const perm of cap.permissions as string[]) {
    assert.equal(perm.includes("*"), false, "permissions must not use wildcards");
    assert.equal(/^(shell|fs|http):/i.test(perm), false, "must not grant broad shell/fs/http");
  }
});

test("rust-shell/Cargo.toml stays isolated from desktop-tauri for offline zero-dep builds", () => {
  const workspaceToml = readRepoFile("rust-shell/Cargo.toml");
  const tauriToml = readRepoFile("rust-shell/desktop-tauri/Cargo.toml");
  assert.match(workspaceToml, /"crates\/mso-shell-core"/);
  assert.match(workspaceToml, /"crates\/mso-shell-host"/);
  assert.equal(workspaceToml.includes("desktop-tauri"), false);
  assert.equal(workspaceToml.includes("tauri"), false);
  assert.match(tauriToml, /^\[workspace\]\s*$/m);
});

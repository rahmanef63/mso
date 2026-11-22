#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(MODULE_PATH), "..");
const DEFAULT_RUST_BIN = path.join(REPO_ROOT, "rust-shell/target/release/mso-shell-host");
const DEFAULT_ASSETS_DIR = path.join(REPO_ROOT, "frontend/svelte/build");
const DEFAULT_PORT = 4174;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

export function parseLoopbackOrigin(raw) {
  if (typeof raw !== "string" || !raw.length || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null;
  }
  return parsed.origin;
}

const isFile = (p) => {
  try { return typeof p === "string" && p.length > 0 && existsSync(p) && statSync(p).isFile(); }
  catch { return false; }
};

const isDir = (p) => {
  try { return typeof p === "string" && p.length > 0 && existsSync(p) && statSync(p).isDirectory(); }
  catch { return false; }
};

const fallbackNext = (requested, reason, detail) => ({
  runtime: "next",
  requested,
  fallback: true,
  reason,
  detail,
  command: null,
  args: [],
});

export function selectRuntime(opts = {}) {
  const env = opts.env && typeof opts.env === "object" ? opts.env : {};
  const requested = String(opts.requested ?? env.MSO_RUNTIME ?? "next").trim().toLowerCase() || "next";

  if (requested === "next") {
    return {
      runtime: "next",
      requested: "next",
      fallback: false,
      reason: "default_next",
      detail: "Next runtime selected.",
      command: null,
      args: [],
    };
  }
  if (requested !== "hybrid") {
    return fallbackNext(requested, "unsupported_runtime", `Unknown runtime '${requested}'; falling back to next.`);
  }

  const rustBin = opts.rustBin ?? env.MSO_RUST_SHELL_BIN ?? DEFAULT_RUST_BIN;
  const assetsDir = opts.assetsDir ?? env.MSO_SVELTE_BUILD_DIR ?? DEFAULT_ASSETS_DIR;
  const apiOriginRaw = opts.apiOrigin ?? env.MSO_SVELTE_API_ORIGIN ?? "";
  const managedHostTemplate = opts.managedHostTemplate ?? env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE ?? null;
  const nativeMetrics = Boolean(opts.nativeMetrics);
  const nativeFsRoot = opts.nativeFsRoot ?? null;
  const port = opts.port ?? DEFAULT_PORT;

  if (!isFile(rustBin)) {
    return fallbackNext("hybrid", "missing_rust_binary", `Compiled Rust host binary not found at ${rustBin}.`);
  }
  const indexHtml = path.join(String(assetsDir), "index.html");
  if (!isFile(indexHtml)) {
    return fallbackNext("hybrid", "missing_svelte_build", `Svelte static build entry not found at ${indexHtml}.`);
  }
  const apiOrigin = parseLoopbackOrigin(apiOriginRaw);
  if (!apiOrigin) {
    return fallbackNext("hybrid", "invalid_loopback_api_origin", "Valid loopback --api-origin is required.");
  }
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    return fallbackNext("hybrid", "invalid_port", `Port must be an integer in 0..65535 (got ${port}).`);
  }
  if (nativeFsRoot !== null && nativeFsRoot !== "" && !isDir(nativeFsRoot)) {
    return fallbackNext("hybrid", "missing_native_fs_root", `Native FS root directory not found at ${nativeFsRoot}.`);
  }

  const args = ["--assets", assetsDir, "--port", String(portNum), "--api-origin", apiOrigin];
  if (managedHostTemplate) args.push("--managed-host-template", String(managedHostTemplate));
  if (nativeMetrics) args.push("--native-metrics");
  if (nativeFsRoot) args.push("--native-fs-root", String(nativeFsRoot));

  return {
    runtime: "hybrid",
    requested: "hybrid",
    fallback: false,
    reason: null,
    detail: "Hybrid Svelte + Rust shell host prerequisites verified.",
    command: rustBin,
    args,
    prereqs: { rustBin, assetsDir, apiOrigin, port: portNum, nativeMetrics, nativeFsRoot: nativeFsRoot || null },
  };
}

/** @param {{ currentRuntime?: string; lastKnownGoodSha?: string | null }} [opts] */
export function buildRollbackPlan({ currentRuntime = "hybrid", lastKnownGoodSha = null } = {}) {
  /** @type {Array<{ order: number; action: string; command?: string; target?: string; sha?: string; note: string }>} */
  const steps = [
    {
      order: 1,
      action: "select_next_runtime",
      command: "node scripts/hybrid-runtime.mjs --check --runtime=next",
      note: "Revert runtime selection to default Next shell with zero data conversion.",
    },
    {
      order: 2,
      action: "preserve_state_dir",
      target: "~/.mso",
      note: "Keep ~/.mso state, sessions, device approvals, and secrets untouched.",
    },
    {
      order: 3,
      action: "verify_next_server",
      command: "scripts/server.mjs",
      note: "Confirm Next cockpit serves / and /api/auth/me on the loopback port.",
    },
  ];
  if (lastKnownGoodSha) {
    steps.push({
      order: 4,
      action: "verify_last_known_good_sha",
      sha: String(lastKnownGoodSha),
      note: `Confirm repository checkout matches last known good commit ${lastKnownGoodSha}.`,
    });
  }
  return {
    fromRuntime: currentRuntime,
    toRuntime: "next",
    lastKnownGoodSha: lastKnownGoodSha ? String(lastKnownGoodSha) : null,
    nextIntact: true,
    stateDirectory: "~/.mso",
    stateConversionRequired: false,
    steps,
  };
}

export function parseCliArgs(argv) {
  const out = { check: false, rollbackPlan: false, nativeMetrics: false };
  const valueFlags = {
    "--runtime": "requested",
    "--rust-bin": "rustBin",
    "--assets": "assetsDir",
    "--api-origin": "apiOrigin",
    "--port": "port",
    "--managed-host-template": "managedHostTemplate",
    "--native-fs-root": "nativeFsRoot",
    "--sha": "lastKnownGoodSha",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") { out.check = true; continue; }
    if (arg === "--rollback-plan") { out.rollbackPlan = true; continue; }
    if (arg === "--native-metrics") { out.nativeMetrics = true; continue; }
    const eqIdx = arg.indexOf("=");
    const flag = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
    const key = valueFlags[flag];
    if (key) out[key] = eqIdx >= 0 ? arg.slice(eqIdx + 1) : (argv[++i] ?? "");
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  const parsed = parseCliArgs(process.argv.slice(2));
  const selection = selectRuntime(parsed);
  const payload = parsed.rollbackPlan
    ? { ...selection, rollbackPlan: buildRollbackPlan({ currentRuntime: selection.runtime, lastKnownGoodSha: parsed.lastKnownGoodSha }) }
    : selection;
  console.log(JSON.stringify(payload, null, 2));
}

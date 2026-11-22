#!/usr/bin/env node
// Standalone CLI for scaffolding, validating, and hot-deploying modular MSO features
// into ~/.mso/features/<id>/ without rebuilding Next.js or restarting mso.service.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const ROLES = new Set(["viewer", "operator", "owner"]);

function featuresRoot() {
  return process.env.MSO_FEATURES_DIR?.trim()
    ? path.resolve(process.env.MSO_FEATURES_DIR.trim())
    : path.join(os.homedir(), ".mso", "features");
}

function usage() {
  console.log([
    "Usage: bun run feature:pack <command> [args]",
    "  init <dir> <id> <title>   Scaffold a standalone modular feature package",
    "  deploy <dir>              Validate, hash, and hot-deploy into ~/.mso/features/<id>",
    "  list                      List installed modular features and active versions",
    "  remove <id>               Uninstall a modular feature package",
  ].join("\n"));
}

function sha256(bytes) {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

function cmdInit(dir, id, title) {
  if (!dir || !id || !title || !ID_RE.test(id)) {
    console.error("init requires <dir> <lowercase-id> <title>");
    process.exit(2);
  }
  const target = path.resolve(dir);
  mkdirSync(path.join(target, "dist"), { recursive: true });
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #0f172a; color: #e2e8f0; }
    .card { max-width: 640px; border: 1px solid #334155; border-radius: 12px; padding: 16px; background: #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>Independent modular MSO feature (${id}). Update dist/ and re-run deploy without rebuilding MSO core.</p>
  </div>
</body>
</html>
`;
  writeFileSync(path.join(target, "dist", "index.html"), html);
  const manifest = {
    schemaVersion: 1,
    id,
    version: "0.1.0",
    title,
    description: "Standalone modular MSO feature package",
    minRole: "owner",
    entry: "index.html",
    defaultSize: { w: 920, h: 620 },
  };
  writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Scaffolded modular feature '${id}' at ${target}`);
}

function cmdDeploy(dir) {
  if (!dir) { console.error("deploy requires <dir>"); process.exit(2); }
  const src = path.resolve(dir);
  const manifestPath = path.join(src, "manifest.json");
  const distDir = path.join(src, "dist");
  if (!existsSync(manifestPath) || !existsSync(distDir)) {
    console.error("Package must contain manifest.json and dist/");
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!ID_RE.test(String(raw.id ?? ""))) throw new Error("manifest.id must match ^[a-z][a-z0-9-]{1,40}$");
  if (!SEMVER_RE.test(String(raw.version ?? ""))) throw new Error("manifest.version must be valid semver");
  const minRole = raw.minRole ?? "owner";
  if (!ROLES.has(minRole)) throw new Error("manifest.minRole must be viewer, operator, or owner");
  const entry = String(raw.entry ?? "index.html");
  if (!entry || entry.startsWith("/") || entry.includes("..")) throw new Error("invalid manifest.entry");
  const entryFile = path.join(distDir, entry);
  if (!existsSync(entryFile)) throw new Error(`missing entry file dist/${entry}`);

  const manifest = {
    ...raw,
    schemaVersion: 1,
    minRole,
    entry,
    integrity: sha256(readFileSync(entryFile)),
    updatedAt: new Date().toISOString(),
  };

  const root = featuresRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, manifest.id);
  const staging = path.join(root, `.staging-${manifest.id}-${Date.now()}`);
  const backup = path.join(root, `.previous-${manifest.id}-${Date.now()}`);
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  cpSync(distDir, path.join(staging, "dist"), { recursive: true, dereference: false });
  writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  if (existsSync(target)) renameSync(target, backup);
  renameSync(staging, target);
  rmSync(backup, { recursive: true, force: true });
  console.log(`Deployed modular feature '${manifest.id}@${manifest.version}' -> ${target} (no MSO rebuild or restart needed)`);
}

function cmdList() {
  const root = featuresRoot();
  if (!existsSync(root)) { console.log("No modular features installed."); return; }
  const rows = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
    const mp = path.join(root, entry.name, "manifest.json");
    if (!existsSync(mp)) continue;
    try {
      const m = JSON.parse(readFileSync(mp, "utf8"));
      rows.push(`${m.id}@${m.version}  role=${m.minRole}  title="${m.title}"  updated=${m.updatedAt}`);
    } catch { /* skip malformed */ }
  }
  console.log(rows.length ? rows.join("\n") : "No modular features installed.");
}

function cmdRemove(id) {
  if (!id || !ID_RE.test(id)) { console.error("remove requires a valid <id>"); process.exit(2); }
  const target = path.join(featuresRoot(), id);
  if (!existsSync(target)) { console.error(`Feature '${id}' is not installed.`); process.exit(1); }
  rmSync(target, { recursive: true, force: true });
  console.log(`Removed modular feature '${id}'.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "init") cmdInit(rest[0], rest[1], rest[2]);
else if (cmd === "deploy") cmdDeploy(rest[0]);
else if (cmd === "list") cmdList();
else if (cmd === "remove") cmdRemove(rest[0]);
else { usage(); process.exit(cmd ? 2 : 0); }

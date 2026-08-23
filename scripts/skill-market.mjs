#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const market = path.join(repo, "skill-market");
const catalog = JSON.parse(fs.readFileSync(path.join(market, "catalog.json"), "utf8"));
const root = path.resolve(process.env.MSO_SKILL_INSTALL_ROOT || path.join(os.homedir(), ".mso", "skills"));
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const fail = (message) => { console.error(`mso skills: ${message}`); process.exitCode = 1; };

function safeEntry(id) {
  const entry = catalog.skills.find((row) => row.id === id);
  if (!entry) throw new Error(`unknown market skill "${id}"; run: mso skills available`);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.id)) throw new Error(`invalid catalog id: ${entry.id}`);
  const file = path.resolve(market, entry.file);
  if (!file.startsWith(`${market}${path.sep}`)) throw new Error(`catalog path escapes market: ${entry.file}`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${entry.id}: SKILL.md must be a regular file`);
  const body = fs.readFileSync(file);
  if (body.length === 0 || body.length > 256 * 1024) throw new Error(`${entry.id}: invalid SKILL.md size`);
  if (sha(body) !== entry.sha256) throw new Error(`${entry.id}: catalog hash mismatch; repository review is stale`);
  const text = body.toString("utf8");
  const match = text.match(/^---\s*\n[\s\S]*?^name:\s*["']?([^\n"']+)["']?\s*$[\s\S]*?^---\s*$/m);
  if (!match || match[1].trim() !== entry.id) throw new Error(`${entry.id}: SKILL.md frontmatter name does not match catalog id`);
  return { entry, file, body };
}

function ensureRoot() {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`install root is not a real directory: ${root}`);
}

function installedState(entry) {
  const dir = path.join(root, entry.id);
  if (!fs.existsSync(dir)) return "not-installed";
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) return "conflict";
  const skill = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skill) || fs.lstatSync(skill).isSymbolicLink()) return "conflict";
  return sha(fs.readFileSync(skill)) === entry.sha256 ? "installed" : "modified";
}

async function confirm(question, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

async function installOne(id, { yes, force }) {
  const { entry, body } = safeEntry(id);
  ensureRoot();
  const state = installedState(entry);
  if (state === "installed") { console.log(`${id}: already installed`); return; }
  if ((state === "modified" || state === "conflict") && !force) {
    throw new Error(`${id}: existing local skill would be overwritten; inspect it, then use --force explicitly`);
  }
  if ((state === "modified" || state === "conflict") && !(await confirm(`Replace existing ${id}?`, yes))) {
    throw new Error(`${id}: not replaced`);
  }

  const target = path.join(root, id);
  const temp = path.join(root, `.mso-market-${id}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(temp, { mode: 0o700 });
  try {
    fs.writeFileSync(path.join(temp, "SKILL.md"), body, { mode: 0o600 });
    fs.writeFileSync(path.join(temp, ".mso-market.json"), JSON.stringify({
      catalogVersion: catalog.version,
      id: entry.id,
      sha256: entry.sha256,
      sourceRef: entry.sourceRef,
      sourceVersion: entry.sourceVersion,
      installedAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  console.log(`${id}: installed → ${target}`);
}

async function removeOne(id, { yes }) {
  const { entry } = safeEntry(id);
  const target = path.join(root, entry.id);
  if (!fs.existsSync(target)) { console.log(`${id}: not installed`); return; }
  const marker = path.join(target, ".mso-market.json");
  if (!fs.existsSync(marker)) throw new Error(`${id}: refusing to delete an unmanaged/local skill`);
  let managed;
  try { managed = JSON.parse(fs.readFileSync(marker, "utf8")); } catch { throw new Error(`${id}: invalid market marker; refusing removal`); }
  if (managed.id !== id) throw new Error(`${id}: market marker mismatch; refusing removal`);
  if (!(await confirm(`Remove ${id}?`, yes))) throw new Error(`${id}: not removed (pass -y for non-interactive removal)`);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`${id}: removed`);
}

function printList(json = false) {
  const rows = catalog.skills.map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    version: entry.sourceVersion,
    source: entry.sourceRef,
    security: entry.security,
    state: installedState(entry),
  }));
  if (json) return console.log(JSON.stringify({ catalogVersion: catalog.version, root, skills: rows }, null, 2));
  for (const row of rows) console.log(`${row.id.padEnd(12)} ${row.state.padEnd(13)} ${row.security.padEnd(19)} ${row.title} — ${row.description}`);
}

function printInfo(id) {
  const { entry } = safeEntry(id);
  console.log(JSON.stringify({ ...entry, state: installedState(entry), installRoot: root }, null, 2));
}

const args = process.argv.slice(2);
const command = args.shift() || "list";
const yes = args.includes("-y") || args.includes("--yes");
const force = args.includes("--force");
const json = args.includes("--json");
const ids = args.filter((arg) => !["-y", "--yes", "--force", "--json"].includes(arg));

try {
  if (command === "list" || command === "available") printList(json);
  else if (command === "info") { if (ids.length !== 1) throw new Error("usage: mso skills info <id>"); printInfo(ids[0]); }
  else if (command === "install") {
    if (!ids.length) throw new Error("usage: mso skills install <id…> [-y] [--force]");
    for (const id of ids) await installOne(id, { yes, force });
  } else if (command === "remove" || command === "rm") {
    if (!ids.length) throw new Error("usage: mso skills remove <id…> [-y]");
    for (const id of ids) await removeOne(id, { yes });
  } else throw new Error("commands: available | info <id> | install <id…> [-y] [--force] | remove <id…> [-y]");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

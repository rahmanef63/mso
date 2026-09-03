import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export const nonceFor = (seed, id) => createHash("sha256").update(`${seed}:${id}`).digest("hex").slice(0, 12);
export const file = (name, content) => { mkdirSync(path.dirname(name), { recursive: true, mode: 0o700 }); writeFileSync(name, content, { mode: 0o600 }); return name; };
export const read = (name) => readFileSync(name, "utf8");
export const exactLine = (text, expected) => String(text).split(/\r?\n/).some((row) => row.trim() === expected);
export function makeDir(root, id) { const dir = path.join(root, id); mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }

export function treeSnapshot(root) {
  const rows = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (error) { rows.push([`<TREE_ERROR:${path.relative(root, dir) || "."}>`, `<${error?.code || "UNREADABLE"}>`]); return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name), rel = path.relative(root, full);
      if (entry.isSymbolicLink()) rows.push([rel, "<SYMLINK>"]);
      else if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try { rows.push([rel, readFileSync(full, "utf8")]); }
        catch (error) { rows.push([rel, `<${error?.code || "UNREADABLE"}>`]); }
      } else {
        let kind = "NONREGULAR";
        try { kind = lstatSync(full).isFile() ? "FILE" : "NONREGULAR"; } catch (error) { kind = error?.code || "UNREADABLE"; }
        rows.push([rel, `<${kind}>`]);
      }
    }
  };
  walk(root); return Object.fromEntries(rows);
}

export function exactTree(root, expected) {
  const normalized = Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(treeSnapshot(root)) === JSON.stringify(normalized);
}

export function runNode(cwd, script) {
  const result = spawnSync(process.execPath, [script], { cwd, encoding: "utf8", timeout: 5_000, env: { ...process.env, NO_COLOR: "1" } });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "", signal: result.signal };
}

export function scratchIsPrivate(root) { return (statSync(root).mode & 0o077) === 0; }

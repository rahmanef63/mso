import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function canonical(value) {
  try { return fs.realpathSync(value); } catch { return path.resolve(value); }
}

function runtimeCommand(comm, cmdline) {
  const text = `${comm} ${cmdline}`.replace(/\0/g, " ");
  return (
    /\bnext-server\b/i.test(text) ||
    /node_modules\/next\/dist\/bin\/next\s+start\b/i.test(text) ||
    /\b(?:npm|bun|pnpm)\s+run\s+start(?:\s|$)/i.test(text) ||
    /\byarn\s+start(?:\s|$)/i.test(text)
  );
}

export function findCheckoutRuntime(root, procRoot = "/proc") {
  const target = canonical(root);
  let entries;
  try { entries = fs.readdirSync(procRoot, { withFileTypes: true }); } catch { return null; }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const dir = path.join(procRoot, entry.name);
    let cwd, comm = "", cmdline = "";
    try { cwd = canonical(fs.readlinkSync(path.join(dir, "cwd"))); } catch { continue; }
    if (cwd !== target) continue;
    try { comm = fs.readFileSync(path.join(dir, "comm"), "utf8").trim(); } catch { /* optional */ }
    try { cmdline = fs.readFileSync(path.join(dir, "cmdline"), "utf8"); } catch { /* optional */ }
    if (runtimeCommand(comm, cmdline)) {
      return { pid: Number(entry.name), comm: comm || "next-runtime" };
    }
  }
  return null;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = process.argv[2] || process.cwd();
  const hit = findCheckoutRuntime(root, process.env.MSO_RUNTIME_PROC_ROOT || "/proc");
  if (!hit) process.exit(1);
  process.stdout.write(`${JSON.stringify(hit)}\n`);
}

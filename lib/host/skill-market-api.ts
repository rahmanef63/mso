import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { readBoundedRegularFile } from "./bounded-read";
import type { SkillMarketRow, SkillMarketSnapshot, SkillMarketState } from "@/lib/contracts/skill-market";

const runFile = promisify(execFile);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const installRoot = () => path.resolve(/* turbopackIgnore: true */ process.env.MSO_SKILL_INSTALL_ROOT || path.join(os.homedir(), ".mso", "skills"));
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;

/** Fixed repository-owned program and argv: no manifest can supply executable code. */
async function marketCommand(args: string[]) {
  const { stdout } = await runFile(process.execPath, [path.join(process.cwd(), "scripts/skill-market.mjs"), ...args], {
    cwd: process.cwd(), encoding: "utf8", timeout: 12_000, maxBuffer: 512 * 1024,
    env: { NODE_ENV: process.env.NODE_ENV, HOME: os.homedir(), PATH: process.env.PATH, MSO_SKILL_INSTALL_ROOT: installRoot() },
  });
  return stdout;
}

async function installation(row: SkillMarketRow, root: string, catalogDigest: string) {
  const target = path.join(root, row.id);
  const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  let state: SkillMarketState = "not-installed", signature = "absent";
  if (stat) {
    state = "conflict"; signature = `${stat.ino}:${stat.mtimeMs}:${stat.mode}`;
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      const names = (await fs.readdir(target)).sort();
      signature += ":" + names.join(",");
      if (names.length === 2 && names.includes("SKILL.md") && names.includes(".mso-market.json")) {
        const body = await readBoundedRegularFile(path.join(target, "SKILL.md"), 256 * 1024);
        const raw = await readBoundedRegularFile(path.join(target, ".mso-market.json"), 64 * 1024);
        signature += ":" + sha((body ?? "") + "\0" + (raw ?? ""));
        let marker; try { marker = JSON.parse(raw ?? "null"); } catch { marker = null; }
        if (body && marker?.id === row.id && typeof marker.sha256 === "string") {
          state = sha(body) !== marker.sha256 ? "modified" : row.state === "installed" ? "installed" : "update-available";
        }
      }
    }
  }
  return { ...row, state, revision: sha(JSON.stringify([row.id, row.version, catalogDigest, state, signature])),
    canInstall: state === "not-installed" || state === "update-available",
    canRemove: state === "installed" || state === "update-available" };
}

export async function listSkillMarket(): Promise<SkillMarketSnapshot> {
  const root = installRoot();
  // Pins/validates every ancestor; hostile symlink roots fail before the CLI reads them.
  const pin = await pinSecurityStorePath(path.join(root, ".market-state"));
  try {
    const data = JSON.parse(await marketCommand(["list", "--json"])) as SkillMarketSnapshot;
    const catalog = await readBoundedRegularFile(path.join(process.cwd(), "skill-market/catalog.json"), 512 * 1024);
    if (!catalog) throw new Error("Reviewed skill catalog unavailable");
    if (!Array.isArray(data.skills) || data.skills.length > 200 || data.root !== root || data.skills.some(row => !idPattern.test(row.id))) throw new Error("Invalid skill market response");
    return { ...data, skills: await Promise.all(data.skills.map(row => installation(row, root, sha(catalog)))) };
  } finally { await pin.directory.close(); }
}

export async function manageSkillMarket(input: { action: "install" | "remove"; id: string; revision: string }) {
  if (!idPattern.test(input.id) || !["install", "remove"].includes(input.action) || !/^[a-f0-9]{64}$/.test(input.revision)) throw new Error("Inspect the skill before changing its installation");
  return withSecurityStoreLock(path.join(installRoot(), ".market-state"), async () => {
    const before = await listSkillMarket(), row = before.skills.find(item => item.id === input.id);
    if (!row || row.revision !== input.revision) throw new Error("Skill revision changed; refresh before retrying");
    if (!(input.action === "install" ? row.canInstall : row.canRemove)) throw new Error("Refusing to replace or remove modified, unmanaged, or unsafe skill files");
    await marketCommand([input.action, input.id, "-y", ...(input.action === "install" && row.state === "update-available" ? ["--force"] : [])]);
    const after = await listSkillMarket(), changed = after.skills.find(item => item.id === input.id);
    if (changed?.state !== (input.action === "install" ? "installed" : "not-installed")) throw new Error("Skill postcondition failed; refresh installation state");
    return after;
  });
}

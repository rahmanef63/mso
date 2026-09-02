import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { projectSkillTrust } from "@/lib/skills/project-skills";
import { readProjectFunctionsManifest } from "@/lib/host/project-function-manifest";
import { forgeCandidateHash } from "./evaluate";
import { validateForgeCommand } from "./sandbox";
import type { ForgeCandidate, ForgePromotion } from "./types";

function hash(data: Buffer | string): string { return createHash("sha256").update(data).digest("hex"); }
function inside(root: string, child: string): boolean {
  const rel = path.relative(root, child); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function safeMsoDir(projectPath: string): Promise<string> {
  const projectReal = await fs.realpath(projectPath);
  const mso = path.join(projectReal, ".mso"), stat = await fs.lstat(mso).catch(() => null);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("project .mso must be a regular directory");
  if (!stat) await fs.mkdir(mso, { mode: 0o700 });
  const real = await fs.realpath(mso);
  if (!inside(projectReal, real) || real !== mso) throw new Error("project .mso escapes project containment");
  return real;
}

async function targetHash(file: string): Promise<string> {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return "absent";
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) return "invalid";
  return hash(await fs.readFile(file));
}

function assertEvaluated(candidate: ForgeCandidate): void {
  const evaluation = candidate.evaluation;
  if (!evaluation?.passed) throw new Error("forge candidate has not passed evaluation");
  if (evaluation.candidateHash !== forgeCandidateHash(candidate)) throw new Error("forge candidate changed after evaluation; evaluate again");
}

async function promoteSkill(candidate: ForgeCandidate): Promise<ForgePromotion> {
  const mso = await safeMsoDir(candidate.projectPath), root = path.join(mso, "skills"), dir = path.join(root, candidate.skill!.name);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const existing = await fs.lstat(dir).catch(() => null); if (existing) throw new Error("forge refuses to overwrite an existing Skill");
  await fs.mkdir(dir, { mode: 0o700 });
  const file = path.join(dir, "SKILL.md");
  try {
    await fs.writeFile(file, candidate.skill!.content, { mode: 0o600, flag: "wx" });
    const trust = await projectSkillTrust(dir, candidate.projectPath);
    if (trust !== "local") throw new Error(`promoted Skill did not earn local trust (${trust})`);
    return { at: new Date().toISOString(), path: file, verification: "projectSkillTrust=local" };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined); throw error;
  }
}

async function promoteFunction(candidate: ForgeCandidate): Promise<ForgePromotion> {
  const source = await validateForgeCommand(candidate.projectPath, candidate.function!);
  const sourceHash = hash(await fs.readFile(source.script));
  if (!candidate.evaluation?.sourceHash || candidate.evaluation.sourceHash !== sourceHash) throw new Error("project function source changed after evaluation; evaluate again");
  const mso = await safeMsoDir(candidate.projectPath), file = path.join(mso, "functions.json");
  const expected = candidate.evaluation?.targetHash ?? "";
  if (await targetHash(file) !== expected) throw new Error("project functions manifest changed after evaluation; evaluate again");
  const current = await readProjectFunctionsManifest(candidate.projectPath);
  if (current.found && !current.functions) throw new Error(current.error ?? "existing functions manifest is invalid");
  const functions = current.found ? (current.functions ?? []) : [];
  if (functions.some((row) => row.name === candidate.function!.name)) throw new Error("forge refuses to overwrite an existing project function");
  const next = [...functions, {
    name: candidate.function!.name,
    description: candidate.function!.description,
    inputSchema: candidate.function!.inputSchema,
    command: candidate.function!.command,
    timeoutMs: candidate.function!.timeoutMs,
  }];
  if (next.length > 32) throw new Error("project function manifest would exceed 32 functions");
  const tmp = `${file}.${process.pid}.forge.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ version: 1, functions: next }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
  const verified = await readProjectFunctionsManifest(candidate.projectPath);
  const verifiedFunctions = verified.found ? verified.functions : undefined;
  if (!verifiedFunctions?.some((row) => row.name === candidate.function!.name)) throw new Error("promoted function failed manifest verification");
  return { at: new Date().toISOString(), path: file, verification: "functions.json parsed and candidate present" };
}

export async function promoteForgeCandidate(candidate: ForgeCandidate): Promise<ForgePromotion> {
  assertEvaluated(candidate);
  return candidate.kind === "skill" ? promoteSkill(candidate) : promoteFunction(candidate);
}

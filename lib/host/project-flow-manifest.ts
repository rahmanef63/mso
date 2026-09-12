import path from "node:path";
import { promises as fs } from "node:fs";
import { readBoundedRegularFile } from "./bounded-read";
import { resolveReadable } from "./paths";
import { makeDir, writeFileGuarded, sha256Text } from "./fs-api";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { parseFlow, object } from "@/lib/workflow/automation-schema";
import type { AutomationFlow } from "@/lib/contracts/automation";

export async function readProjectFlows(projectPath: string): Promise<{ flows: AutomationFlow[]; revision: string }> {
  const directory = path.join(projectPath, ".mso"), file = path.join(directory, "flows.json");
  const stat = await fs.lstat(directory).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
  if (!stat) return { flows: [], revision: "new" };
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error("unsafe project flow directory");
  const exists = await fs.lstat(file).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
  if (!exists) return { flows: [], revision: "new" };
  if (exists.isSymbolicLink()) throw new Error("unsafe project flow manifest");
  await resolveReadable(file);
  const raw = await readBoundedRegularFile(file, 64 * 1024);
  if (raw === null) throw new Error("flow manifest unreadable or exceeds 64 KiB");
  const parsed: unknown = JSON.parse(raw);
  if (!object(parsed) || parsed.version !== 1 || Object.keys(parsed).some(k => !["version", "flows"].includes(k)) ||
      !Array.isArray(parsed.flows) || parsed.flows.length > 32) throw new Error("flow manifest must be {version:1,flows:[up to 32 flows]}");
  const flows = parsed.flows.map(parseFlow);
  if (new Set(flows.map(flow => flow.id)).size !== flows.length) throw new Error("duplicate flow id");
  return { flows, revision: sha256Text(raw) };
}
export async function manageProjectFlow(projectPath: string, input: { action: "upsert" | "delete"; id: string; flow?: unknown; revision: string }) {
  const directory = path.join(projectPath, ".mso"), file = path.join(directory, "flows.json");
  await makeDir(directory);
  return withSecurityStoreLock(file, async () => {
    const current = await readProjectFlows(projectPath);
    if (current.revision !== input.revision) throw new Error("flow revision changed; inspect before editing");
    const definition = input.action === "upsert" ? parseFlow(input.flow) : undefined;
    if (definition && definition.id !== input.id) throw new Error("flow id mismatch");
    const flows = current.flows.filter(flow => flow.id !== input.id);
    if (definition) flows.push(definition);
    if (flows.length > 32) throw new Error("project flow limit is 32");
    const content = JSON.stringify({ version: 1, flows }, null, 2) + "\n";
    if (Buffer.byteLength(content) > 64 * 1024) throw new Error("flow manifest exceeds 64 KiB");
    const result = await writeFileGuarded({ path: file, content, ...(current.revision !== "new" ? { expectedSha256: current.revision } : {}) });
    return { id: input.id, action: input.action, revision: result.sha256 };
  });
}

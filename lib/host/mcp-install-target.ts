import path from "node:path";
import { promises as fs } from "node:fs";
import { makeDir } from "./fs-api";
import { resolveReadable, safeWritePath, writeRootList } from "./paths";
import { resolveProjectHint } from "./projects-api";

/** Explicit host scope, never an inherited project dependency or private credential store. */
export async function resolveMcpInstallTarget(hint: string, create = false) {
  if (hint !== "@host") {
    const project = await resolveProjectHint(hint);
    if (!project || project.matchedBy === "fuzzy") throw new Error("exact project required");
    return { id: project.id, name: project.name, path: project.path, installationScope: "project" as const };
  }
  const firstRoot = writeRootList()[0];
  if (!firstRoot || path.resolve(firstRoot) === path.parse(firstRoot).root) throw new Error("Host MCP needs an owner writable root");
  const directory = path.resolve(firstRoot, ".mso-host-mcp");
  const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null; throw error;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Host MCP directory must not be a symlink");
  await safeWritePath(directory, Boolean(stat));
  if (!stat && create) await makeDir(directory);
  if (stat || create) await resolveReadable(directory);
  return { id: "@host", name: "This MSO host", path: directory, installationScope: "host" as const };
}

import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { agentSessionArchiveRoot } from "@/lib/agent/session-archive";
import { workflowStorePath } from "@/lib/workflow/storage";
import { listProjectDirs } from "@/lib/host/project-roots";
export type Source = { key: string; path: string };
export async function memorySources(): Promise<{ sources: Source[]; incomplete: boolean }> {
  const home = path.join(os.homedir(), ".mso");
  const recipes = workflowStorePath();
  const sources: Source[] = [
    { key: "memory", path: path.resolve(process.env.OS_AGENT_MEMORY_DIR || path.join(home, "agent-memory")) },
    { key: "session-archive", path: agentSessionArchiveRoot() },
    { key: "recipes", path: recipes },
    { key: "active-workflows", path: recipes + ".active.json" },
    { key: "recipe-archive", path: recipes + ".archive-v1" },
    { key: "organization", path: (process.env.OS_ORGANIZATION_STORE || path.join(home, "private", "organization.json")).replace(/^~(?=$|\/)/, os.homedir()) },
  ];
  const projects = await listProjectDirs();
  projects.dirs.forEach(({ dir }) => {
    const index = createHash("sha256").update(dir).digest("hex").slice(0, 16);
    sources.push({ key: `project-${index}-agent`, path: path.join(dir, ".agent") });
    sources.push({ key: `project-${index}-knowledge`, path: path.join(dir, ".mso", "KNOWLEDGE.md") });
  });
  // Preserve core memory and project evidence before the much larger session inventory.
  sources.push({ key: "sessions", path: agentSessionsDir() });
  return { sources, incomplete: projects.scan.truncated || projects.scan.skippedRoots.length > 0 };
}

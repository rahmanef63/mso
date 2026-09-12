import { ownedArtifactSession } from "@/lib/agent/artifact-session";
import { readSessionArtifact } from "@/lib/agent/artifacts";
import { attachProjectAsset } from "@/lib/host/project-assets";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { type McpTool, S, str, opt } from "./tool-kit";
export const PROJECT_ASSET_TOOLS: McpTool[] = [{
  name: "project_asset_attach", title: "Attach Asset to Project", scope: "write",
  description: "Copy one owned session image/JSON artifact into an exact project at relative_path. Verifies source checksum and creates the destination atomically; same bytes are idempotent, different existing bytes are refused. Project copy survives session cleanup. Preview with session_artifacts; manage project files with fs_*.",
  chatgptDescription: "Save a session image/JSON permanently into an exact project. Requires artifact_id and relative_path; never overwrites different content.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  limit: { key: "project.asset.attach", max: 20, windowMs: 60_000 },
  audit: { action: "fs.write", targetArg: "relative_path" },
  inputSchema: S({ project: { type: "string" }, artifact_id: { type: "string" }, relative_path: { type: "string", maxLength: 1024 }, session_id: { type: "string", description: "Optional source session owned by this principal; defaults to current." } }, ["project", "artifact_id", "relative_path"]),
  run: async (a, context) => {
    const project = await resolveProjectHint(str(a, "project"));
    if (!project || project.matchedBy === "fuzzy") throw new Error("exact project required");
    const owner = await ownedArtifactSession(context.principal, opt(a, "session_id") || context.sessionId);
    const source = await readSessionArtifact(owner, str(a, "artifact_id"));
    return { project: project.id, artifactId: source.entry.id, ...await attachProjectAsset(project.path, str(a, "relative_path"), source.bytes, source.entry.mimeType) };
  },
}];

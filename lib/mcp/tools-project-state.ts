import path from "node:path";
import {
  detectProjectConvex, inspectProject, projectGitDiff, projectGitEdits, projectGitSnapshot,
  publicProjectMcpServers, readProjectKnowledge, readProjectMcpServers,
  PROJECT_KNOWLEDGE_MAX_BYTES, PROJECT_KNOWLEDGE_REL,
} from "@/lib/host/projects-api";
import { makeDir, writeFileGuarded } from "@/lib/host/fs-api";
import { INFRA_PROVIDER_IDS, readInfraProvider, summarizeInfraProvider } from "@/lib/infra";
import { type McpTool, S, str, opt, READ_ONLY } from "./tool-kit";
import { DIFF_VIEW_URI, PROJECT_STATUS_URI } from "./ui-resources";
import { selectedProject } from "./tools-project-shared";

const PROJECT_STATUS_OUTPUT = {
  type: "object",
  properties: {
    project: { type: "object" }, git: { type: "object" }, package: { type: "object" },
    database: { type: "object" }, integrations: { type: "object" }, knowledge: { type: "object" },
  },
  required: ["project", "git", "package", "database", "integrations", "knowledge"], additionalProperties: false,
} as const;

const DIFF_OUTPUT = {
  type: "object",
  properties: {
    project: { type: "object" }, mode: { type: "string" }, sha: { type: "string" }, baseSha: { type: "string" },
    summary: { type: "object" }, files: { type: "array", items: { type: "object" } },
  },
  required: ["project", "mode", "summary", "files"], additionalProperties: false,
} as const;

export const PROJECT_STATE_TOOLS: McpTool[] = [
  {
    name: "project_get",
    title: "Get Project",
    description: "Get one canonical MSO project snapshot: identity, package metadata, bounded Git state, safe capability metadata, project MCP aliases, Convex detection, and project-knowledge presence. This is the first read for project status/preview-style experiences.",
    chatgptDescription: "Get a canonical project snapshot with Git, package, Convex, integration and knowledge status. No secrets are returned.",
    scope: "read", annotations: READ_ONLY,
    outputSchema: PROJECT_STATUS_OUTPUT,
    meta: {
      ui: { resourceUri: PROJECT_STATUS_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": PROJECT_STATUS_URI,
      "openai/toolInvocation/invoking": "Opening MSO project…",
      "openai/toolInvocation/invoked": "MSO project opened",
      "openai/widgetAccessible": true,
    },
    toStructuredContent: (value) => {
      if (!value || typeof value !== "object") return undefined;
      const row = value as Record<string, unknown>;
      return { project: row.project, git: row.git, package: row.package, database: row.database, integrations: row.integrations, knowledge: row.knowledge };
    },
    inputSchema: S({ project: { type: "string", description: "Exact project id/path/name from projects_list." } }, ["project"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      const [snapshot, inspected, servers, database, knowledge] = await Promise.all([
        projectGitSnapshot(project.path), inspectProject(project), readProjectMcpServers(project.path), detectProjectConvex(project.path), readProjectKnowledge(project.path),
      ]);
      return {
        project: { id: project.id, name: project.name, path: project.path, rootId: project.rootId, root: project.root, aliases: project.aliases, matchedBy: project.matchedBy },
        git: snapshot,
        package: inspected.package,
        capabilities: inspected.capabilities ?? {},
        database,
        integrations: { projectMcp: publicProjectMcpServers(servers) },
        knowledge: { exists: knowledge.exists, path: knowledge.path, bytes: knowledge.bytes, sha256: knowledge.sha256 },
      };
    },
  },
  {
    name: "project_changes_list",
    title: "List Project Changes",
    description: "List bounded Git edit history for one project, newest first. Each row exposes a commit SHA usable by project_diff. Cursor pagination is SHA-based and deterministic.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: S({
      project: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 50, description: "Default 20." },
      cursor: { type: "string", description: "Commit SHA from pagination.nextCursor." },
    }, ["project"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      return { project: { id: project.id, name: project.name }, ...(await projectGitEdits(project.path, { limit: typeof a.limit === "number" ? a.limit : undefined, cursor: opt(a, "cursor") })) };
    },
  },
  {
    name: "project_diff",
    title: "Get Project Diff",
    description: "Get a bounded unified Git diff plus per-file additions/deletions. With sha, compares that commit to base_sha or its parent; without sha, reads the working tree or staged changes.",
    scope: "read", annotations: READ_ONLY,
    result: { maxTextBytes: 96 * 1024, overflowHint: "The unified diff was compacted; request a narrower commit or inspect one file." },
    outputSchema: DIFF_OUTPUT,
    meta: {
      ui: { resourceUri: DIFF_VIEW_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": DIFF_VIEW_URI,
      "openai/toolInvocation/invoking": "Opening project diff…",
      "openai/toolInvocation/invoked": "Project diff opened",
    },
    toStructuredContent: (value) => {
      if (!value || typeof value !== "object") return undefined;
      const row = value as Record<string, unknown>;
      return { project: row.project, mode: row.mode, ...(row.sha ? { sha: row.sha } : {}), ...(row.baseSha ? { baseSha: row.baseSha } : {}), summary: row.summary, files: row.files };
    },
    inputSchema: S({
      project: { type: "string" }, sha: { type: "string" }, base_sha: { type: "string" },
      staged: { type: "boolean", description: "When no sha is given, compare staged changes instead of the working tree." },
    }, ["project"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      return { project: { id: project.id, name: project.name }, ...(await projectGitDiff(project.path, { sha: opt(a, "sha"), baseSha: opt(a, "base_sha"), staged: a.staged === true })) };
    },
  },
  {
    name: "project_knowledge_get",
    title: "Get Project Knowledge",
    description: "Read the project's always-on MSO knowledge file (.mso/KNOWLEDGE.md). Knowledge is project-wide background context; use skills for on-demand workflows.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: S({ project: { type: "string" } }, ["project"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      return { project: { id: project.id, name: project.name }, ...(await readProjectKnowledge(project.path)) };
    },
  },
  {
    name: "project_knowledge_set",
    title: "Set Project Knowledge",
    description: `Replace .mso/KNOWLEDGE.md for one project (max ${PROJECT_KNOWLEDGE_MAX_BYTES} UTF-8 bytes). Read project_knowledge_get first and pass expected_sha256 to avoid overwriting concurrent changes. Empty content clears the knowledge text but keeps the canonical file.`,
    scope: "write", annotations: { destructiveHint: true, idempotentHint: true },
    limit: { key: "project.knowledge", max: 30, windowMs: 60_000 }, audit: { action: "fs.write" as const, targetArg: "project" },
    inputSchema: S({
      project: { type: "string" }, content: { type: "string", maxLength: PROJECT_KNOWLEDGE_MAX_BYTES },
      expected_sha256: { type: "string", description: "SHA-256 from project_knowledge_get; omit only when intentionally creating/replacing without CAS." },
    }, ["project", "content"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      const content = typeof a.content === "string" ? a.content : "";
      if (Buffer.byteLength(content, "utf8") > PROJECT_KNOWLEDGE_MAX_BYTES) throw new Error(`project knowledge exceeds ${PROJECT_KNOWLEDGE_MAX_BYTES} UTF-8 bytes`);
      const dir = path.join(project.path, ".mso"); await makeDir(dir);
      const written = await writeFileGuarded({ path: path.join(project.path, PROJECT_KNOWLEDGE_REL), content, expectedSha256: opt(a, "expected_sha256") });
      return { project: { id: project.id, name: project.name }, ...written, path: PROJECT_KNOWLEDGE_REL };
    },
  },
  {
    name: "connections_list",
    title: "List Connections",
    description: "List MSO's safe connection inventory: masked infrastructure providers plus, when a project is selected, project MCP aliases and Convex database detection. Credentials, headers and raw provider secrets are never returned.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: S({ project: { type: "string", description: "Optional project id/path/name." } }),
    run: async (a) => {
      const projectHint = opt(a, "project");
      const project = projectHint ? await selectedProject(projectHint) : undefined;
      const [infra, servers, database] = await Promise.all([
        Promise.all(INFRA_PROVIDER_IDS.map(async (id) => summarizeInfraProvider(id, await readInfraProvider(id)))),
        project ? readProjectMcpServers(project.path) : Promise.resolve([]),
        project ? detectProjectConvex(project.path) : Promise.resolve(undefined),
      ]);
      return {
        infrastructure: infra,
        ...(project ? { project: { id: project.id, name: project.name }, projectMcp: publicProjectMcpServers(servers), database } : {}),
      };
    },
  },
];

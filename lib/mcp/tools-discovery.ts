import { listProjects, projectCapabilities, publicProjectMcpServers, readProjectMcpServers, resolveProjectHint, PROJECT_LIMITS } from "@/lib/host/projects-api";
import { catalogSkillsDetailed, resolveSkill, readSkillFile, skillIsExecutableByDefault, SKILL_SCAN_LIMITS } from "@/lib/skills/catalog";
import { type McpTool, str, opt, S, READ_ONLY } from "./tool-kit";

// GLOBAL discovery: every project container the owner configured, and every skill
// root inside them. MSO used to answer both questions from `~/projects` and the
// global skill roots alone, which quietly told a connected client that a
// multi-project box had one project and no project skills. All three tools are
// `read` — enumerating what exists changes nothing, and a read token is exactly the
// grant an agent should need to plan its work.
//
// Every one of them returns a `scan` report. A truncated enumeration that looks
// complete is the failure mode worth engineering against: a model that believes it
// has seen every project will confidently tell the owner a project does not exist.

const SKILL_PAGE_MAX = 200;

const page = (a: Record<string, unknown>, max: number, fallback: number) => ({
  limit: Math.min(Math.max(Math.round(typeof a.limit === "number" ? a.limit : fallback), 1), max),
  offset: Math.max(Math.round(typeof a.offset === "number" ? a.offset : 0), 0),
});

export const DISCOVERY_TOOLS: McpTool[] = [
  {
    name: "project_capabilities",
    description:
      "Inspect ONE validated project for opt-in automation capabilities without exposing secrets. " +
      "Reports whether a regular .mcp.json exists and, when present, the public name/description/schema metadata from .mso/functions.json. " +
      "Project function commands are deliberately withheld; execution is only through project_function_call at exec scope. " +
      "Nothing is enabled globally: projects without these files return an empty capability object.",
    chatgptDescription: "Inspect one selected project for opt-in MSO functions and project MCP server aliases. Secrets and project MCP tool names stay hidden until project_mcp_tools is called.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "projects.capabilities", max: 60, windowMs: 60_000 },
    inputSchema: S({
      project: { type: "string", description: "Exact project id from projects_list, absolute path, name or alias." },
    }, ["project"]),
    run: async (a) => {
      const project = await resolveProjectHint(str(a, "project"));
      if (!project) throw new Error(`project not found: ${String(a.project)}`);
      const capabilities = (await projectCapabilities(project.path)) ?? {};
      if (capabilities.mcp) capabilities.mcp.servers = publicProjectMcpServers(await readProjectMcpServers(project.path));
      return { project: { id: project.id, name: project.name, path: project.path }, capabilities };
    },
  },
  {
    name: "projects_list",
    description:
      "Enumerate the owner's projects across EVERY configured project container (each OS_FS_READ_ROOTS entry and its projects/ subdirectory), not just ~/projects. " +
      "Returns a globally unique id (<rootId>/<name>, so two roots may hold a project of the same name), absolute path, its container root, package name/version, bounded Git branch/head, and opt-in MCP/function capability summary. " +
      "USE THIS FIRST when the user names a project you have not located — it is one call, needs no shell scope, and its id or path is the input to workflow_start. " +
      "Hidden directories, symlinks, credential paths and directories not owned by the MSO user are excluded. " +
      "ALWAYS check `scan.truncated`: when true the listing is incomplete and `scan.truncationReasons` says which cap was hit — do not report that a project is absent from a truncated scan. " +
      "Every cap is resumable: pass `scan.continuation.cursor` back as `cursor` to continue, and use `nextOffset`/`hasMore` for ordinary paging within one scan.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "projects.list", max: 30, windowMs: 60_000 },
    inputSchema: S({
      query: { type: "string", description: "Optional case-insensitive substring matched against the directory name." },
      limit: { type: "number", minimum: 1, maximum: PROJECT_LIMITS.maxPageSize, description: `Page size. Default ${PROJECT_LIMITS.defaultPageSize}.` },
      offset: { type: "number", minimum: 0, description: "Page offset into the deterministic container-then-name ordering. Default 0." },
      cursor: { type: "string", description: "scan.continuation.cursor from a truncated call, to resume the walk where it stopped." },
    }),
    run: (a) => listProjects({
      query: opt(a, "query"),
      cursor: opt(a, "cursor"),
      ...page(a, PROJECT_LIMITS.maxPageSize, PROJECT_LIMITS.defaultPageSize),
    }),
  },
  {
    name: "skills_list",
    description:
      "List every SKILL.md MSO can see: the global roots (operator ~/.mso/skills, official MSO skills, hash-verified bundles, generic agent registries) AND the per-project roots " +
      "(.mso/skills, .claude/skills, .hermes/skills, .agents/skills, .codex/skills) of every project across every configured container. " +
      "Each row carries the exact catalog id to pass to skills_read — a project skill is <rootId>/<project>/<name>, so two projects may ship the same skill name in the same or different roots — plus trust, source and its project. " +
      "Trust is earned, not assumed: a project skill is only `local` after realpath containment, owner uid and a regular non-symlink SKILL.md. " +
      "Check `scan.truncated` before concluding a skill does not exist; when it is true, pass `scan.continuation.cursor` back as `cursor` to resume the scan.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "skills.list", max: 30, windowMs: 60_000 },
    inputSchema: S({
      project: { type: "string", description: "Optional project filter: an exact projectId (<rootId>/<name>), an absolute project path, or a bare name. A bare name matching projects in several roots keeps them all and reports them in ambiguousProjects." },
      trust: { type: "string", enum: ["official", "verified", "local", "untrusted"], description: "Optional exact trust filter." },
      query: { type: "string", description: "Optional case-insensitive substring matched against id and description." },
      limit: { type: "number", minimum: 1, maximum: SKILL_PAGE_MAX, description: "Page size. Default 100." },
      offset: { type: "number", minimum: 0, description: "Page offset into the id-sorted catalog. Default 0." },
      cursor: { type: "string", description: "scan.continuation.cursor from a truncated call, to resume the catalog build where it stopped." },
    }),
    run: async (a) => {
      const project = opt(a, "project");
      const trust = opt(a, "trust");
      const query = opt(a, "query")?.toLowerCase();
      const { skills: all, scan } = await catalogSkillsDetailed({ cursor: opt(a, "cursor") });
      const matched = all.filter((skill) => {
        if (project && !(skill.project?.id === project || skill.project?.path === project || skill.project?.name === project)) return false;
        if (trust && skill.trust !== trust) return false;
        if (query && !`${skill.id} ${skill.description}`.toLowerCase().includes(query)) return false;
        return true;
      });
      // A bare project name that hits more than one root is AMBIGUOUS, not wrong: the
      // rows all stay, and the client is told which exact ids it could have meant.
      const projectIds = [...new Set(matched.map((s) => s.project?.id).filter((id): id is string => !!id))];
      const ambiguousProjects = project && projectIds.length > 1
        ? matched.filter((s) => s.project).map((s) => ({ projectId: s.project!.id, name: s.project!.name, path: s.project!.path, rootId: s.project!.rootId }))
          .filter((row, i, rows) => rows.findIndex((r) => r.projectId === row.projectId) === i)
        : undefined;
      const { limit, offset } = page(a, SKILL_PAGE_MAX, 100);
      const pageRows = matched.slice(offset, offset + limit);
      const hasMore = offset + pageRows.length < matched.length;
      return {
        total: matched.length,
        offset,
        limit,
        hasMore,
        ...(hasMore ? { nextOffset: offset + pageRows.length } : {}),
        scan,
        ...(ambiguousProjects ? { ambiguousProjects } : {}),
        skills: pageRows.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: skill.source,
          trust: skill.trust,
          instructionsReadable: skillIsExecutableByDefault(skill),
          ...(skill.project ? { project: skill.project } : {}),
          ...(skill.provenance ? { provenance: skill.provenance } : {}),
        })),
      };
    },
  },
  {
    name: "skills_read",
    description:
      "Read one skill's SKILL.md by its EXACT catalog id from skills_list or skills_search (a project skill is <rootId>/<project>/<name>). " +
      "A bare name is accepted only when it is unambiguous; when several projects ship that name the call is refused and lists the exact ids, rather than guessing which project's instructions you meant. " +
      "Instructions are returned for official, hash-verified, operator-local and ownership-verified project skills. " +
      "An untrusted skill returns metadata only — inspect it as a file and move it into ~/.mso/skills after review to promote it. " +
      "The reader opens only a realpath'd file named SKILL.md, refuses a symlink at that name, and skips anything over the size cap.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "skills.read", max: 60, windowMs: 60_000 },
    inputSchema: S({
      name: { type: "string", description: "Exact catalog id from skills_list, or an unambiguous bare name." },
    }, ["name"]),
    run: async (a) => {
      const id = str(a, "name");
      const { skills, scan } = await catalogSkillsDetailed();
      const { skill, ambiguous } = resolveSkill(skills, id);
      if (ambiguous)
        throw new Error(`"${id}" is ambiguous across projects — call skills_read with one exact id: ${ambiguous.join(", ")}`);
      if (!skill) {
        const hint = scan.truncated ? " (the catalog scan was truncated: " + scan.truncationReasons.join(", ") + ")" : "";
        throw new Error(`unknown skill id "${id}" — call skills_list for the exact ids${hint}`);
      }
      const meta = {
        id: skill.id, name: skill.name, description: skill.description, source: skill.source, trust: skill.trust,
        ...(skill.project ? { project: skill.project } : {}),
      };
      if (!skillIsExecutableByDefault(skill)) {
        return {
          ...meta,
          instructionsWithheld: true,
          reason: `trust=${skill.trust}: MSO does not feed unreviewed skill instructions to a model. Read ${skill.path} as a file, then move the reviewed skill into ~/.mso/skills to promote it.`,
        };
      }
      const content = await readSkillFile(skill.path);
      if (content === null)
        throw new Error(`skill "${skill.id}" has no readable SKILL.md (missing, a symlink, or over the ${SKILL_SCAN_LIMITS.maxSkillBytes}-byte cap)`);
      return { ...meta, content, truncated: false };
    },
  },
];

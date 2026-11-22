import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { rateLimited } from "@/lib/host/limits-api";
import { projectCandidateRevision, searchProjectCandidateIndex } from "@/lib/host/project-candidate-index";
import { inspectProject, resolveProjectHint } from "@/lib/host/projects-api";

export async function handleProjectCandidates(req: Request): Promise<Response> {
  const context = await getSessionContext();
  if (!context?.session.device_id) {
    return json({ error: "unauthorized" }, 401);
  }
  if (rateLimited(`projects.candidates:${context.session.device_id}`, 30, 60_000)) {
    return json({ error: "rate_limited" }, 429);
  }

  const q = new URL(req.url).searchParams;
  const projectHint = (q.get("project") ?? "").trim();
  const query = (q.get("q") ?? "").trim();
  const cursor = (q.get("cursor") ?? "").trim() || undefined;
  const requestedLimit = Number(q.get("limit") ?? "16");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.round(requestedLimit), 1), 40)
    : 16;
  if (!projectHint || !query) {
    return json({ error: "project_and_query_required" }, 400);
  }

  const project = await resolveProjectHint(projectHint).catch(() => null);
  if (!project) return json({ error: "project_not_found" }, 404);

  const repository = await inspectProject(project, { includeGitStatus: true }).catch(() => undefined);
  const result = await searchProjectCandidateIndex({
    projectPath: project.path,
    query,
    revision: projectCandidateRevision(repository),
    limit,
    cursor,
  });
  return json(
    { project: { id: project.id, name: project.name, path: project.path }, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}

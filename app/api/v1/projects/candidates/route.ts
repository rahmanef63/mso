import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { rateLimited } from "@/lib/host/limits-api";
import { projectCandidateRevision, searchProjectCandidateIndex } from "@/lib/host/project-candidate-index";
import { inspectProject, resolveProjectHint } from "@/lib/host/projects-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const context = await getSessionContext();
  if (!context?.session.device_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (rateLimited(`projects.candidates:${context.session.device_id}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
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
    return NextResponse.json({ error: "project_and_query_required" }, { status: 400 });
  }

  const project = await resolveProjectHint(projectHint).catch(() => null);
  if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

  const repository = await inspectProject(project, { includeGitStatus: true }).catch(() => undefined);
  const result = await searchProjectCandidateIndex({
    projectPath: project.path,
    query,
    revision: projectCandidateRevision(repository),
    limit,
    cursor,
  });
  return NextResponse.json(
    { project: { id: project.id, name: project.name, path: project.path }, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}

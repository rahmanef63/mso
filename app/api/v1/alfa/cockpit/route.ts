import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { readConfig, DEFAULT_PROVIDER } from "@/lib/config/store";
import { defaultModelFor } from "@/lib/models/defaults";
import {
  detectProjectConvex,
  inspectProject,
  listProjects,
  projectGitSnapshot,
  publicProjectMcpServers,
  readProjectKnowledge,
  readProjectMcpServers,
  resolveProjectHint,
} from "@/lib/host/projects-api";
import { searchRepoMemory } from "@/lib/orchestration/repo-memory";
import { ownerSessionSummaries } from "@/lib/agent/session-query";
import { listLocalAgents } from "@/lib/agent/local-agent-directory";
import { listMemories } from "@/lib/agent/legacy-owner-memory";
import { agentMemoryTelemetry, queryAgentMemory } from "@/lib/agent/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_PAGE_SIZE = 60;
const RECENT_MEMORY_LIMIT = 6;

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Alfa cockpit failed";
  const status = /not found/i.test(message) ? 404 : /ambiguous/i.test(message) ? 409 : 500;
  return NextResponse.json({ error: message.slice(0, 240) }, { status });
}

export async function GET(req: NextRequest) {
  const context = await getSessionContext();
  if (context?.role !== "owner") return NextResponse.json({ error: "owner_role_required" }, { status: 403 });

  const principal = `cli:${context.session.device_id}`;
  const projectHint = String(req.nextUrl.searchParams.get("project") || "").trim();
  const projectQuery = String(req.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);

  try {
    if (projectQuery) {
      const projectList = await listProjects({ query: projectQuery, limit: 30 });
      return NextResponse.json({
        projects: {
          total: projectList.total, hasMore: projectList.hasMore, scan: projectList.scan,
          rows: projectList.projects.map((project) => ({
            id: project.id, name: project.name, path: project.path,
            packageName: project.packageName, packageVersion: project.packageVersion, git: project.git,
          })),
        },
      });
    }

    const [cfg, projectList, sessions, agents, memories, typedMemory, memoryTelemetry] = await Promise.all([
      readConfig(),
      listProjects({ limit: PROJECT_PAGE_SIZE }),
      ownerSessionSummaries(10),
      listLocalAgents(principal, { includeOffline: false }),
      listMemories(),
      queryAgentMemory(principal, { limit: 10 }),
      agentMemoryTelemetry(principal),
    ]);
    const provider = cfg.provider || DEFAULT_PROVIDER;

    let selectedProject: Record<string, unknown> | null = null;
    if (projectHint) {
      const project = await resolveProjectHint(projectHint);
      if (!project) throw new Error(`project not found: ${projectHint}`);
      const [git, inspected, servers, database, knowledge, recentMemory] = await Promise.all([
        projectGitSnapshot(project.path),
        inspectProject(project),
        readProjectMcpServers(project.path),
        detectProjectConvex(project.path),
        readProjectKnowledge(project.path),
        searchRepoMemory(project.path, { limit: RECENT_MEMORY_LIMIT }),
      ]);
      selectedProject = {
        project: { id: project.id, name: project.name, path: project.path, rootId: project.rootId },
        git,
        package: inspected.package,
        capabilities: inspected.capabilities ?? {},
        database,
        integrations: { projectMcp: publicProjectMcpServers(servers) },
        knowledge: { exists: knowledge.exists, bytes: knowledge.bytes, sha256: knowledge.sha256 },
        recentMemory: recentMemory.map(({ record, score }) => ({
          id: record.id,
          kind: record.kind,
          status: record.status,
          title: record.title,
          updatedAt: record.updatedAt,
          score,
        })),
      };
    }

    return NextResponse.json({
      model: { provider, model: cfg.model || defaultModelFor(provider), tokenSaver: cfg.tokenSaver ?? "off" },
      projects: {
        total: projectList.total,
        hasMore: projectList.hasMore,
        scan: projectList.scan,
        rows: projectList.projects.map((project) => ({
          id: project.id,
          name: project.name,
          path: project.path,
          packageName: project.packageName,
          packageVersion: project.packageVersion,
          git: project.git,
        })),
      },
      selectedProject,
      sessions: sessions.map((session) => ({
        id: session.id,
        name: session.name,
        source: session.source,
        title: session.title,
        updatedAt: session.updatedAt,
        cwd: session.cwd,
        estimatedTokens: session.estimatedTokens,
        eventCount: session.eventCount,
      })),
      localAgents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        label: agent.label,
        status: agent.status,
        title: agent.title,
        cwd: agent.cwd,
        lastSeenAt: agent.lastSeenAt,
      })),
      legacyMemoryCount: memories.length,
      typedMemory: {
        telemetry: memoryTelemetry,
        records: typedMemory.records.map(({ record, conflicts }) => ({
          id: record.id,
          document: record.document,
          key: record.sensitivity === "normal" ? record.key : "Private memory",
          value: record.sensitivity === "normal" ? record.value : "Private memory",
          kind: record.kind,
          confidence: record.confidence,
          sensitivity: record.sensitivity,
          authority: record.provenance.authority,
          observedAt: record.provenance.observedAt,
          conflictCount: conflicts.length,
        })),
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

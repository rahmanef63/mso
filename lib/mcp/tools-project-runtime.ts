import { detectProjectConvex, listProjectConvexTools, callProjectConvexTool } from "@/lib/host";
import { runSessionSubagent } from "@/lib/agent/subagent-runner";
import { createProjectAgentTask, getProjectAgentTask, updateProjectAgentTask } from "@/lib/agent/project-agent-task-store";
import { allows, parseScope } from "./scope";
import { type McpTool, S, str, opt, READ_ONLY } from "./tool-kit";
import { databaseDeployment, selectedProject } from "./tools-project-shared";

export const PROJECT_RUNTIME_TOOLS: McpTool[] = [
  {
    name: "project_database_status",
    title: "Get Convex Database Status",
    description: "Get Convex status for one validated project through the project's installed official Convex MCP server. Supports cloud/local/self-hosted project configuration. MSO pins --project-dir to the selected project and refuses cross-project deployment selectors.",
    scope: "exec", annotations: { destructiveHint: false, openWorldHint: true, idempotentHint: true },
    limit: { key: "projects.mcp.read", max: 30, windowMs: 60_000 }, audit: { action: "exec.run" as const, targetArg: "project" },
    inputSchema: S({ project: { type: "string" }, deployment: { type: "string", description: "Optional dev, prod, local, staging-like name, or dev/<name>." } }, ["project"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      const detection = await detectProjectConvex(project.path);
      if (!detection.detected || !detection.cliAvailable) return { project: { id: project.id, name: project.name }, detection, available: false };
      return { project: { id: project.id, name: project.name }, detection, available: true, status: await callProjectConvexTool(project.path, "status", {}, databaseDeployment(a)) };
    },
  },
  {
    name: "project_database_tools",
    title: "List Convex Database Tools",
    description: "List the supported official Convex MCP schemas for one selected project/deployment. Use this before project_database_call so dynamic Convex schemas stay out of MSO's global ChatGPT catalog.",
    scope: "exec", annotations: { destructiveHint: false, openWorldHint: true, idempotentHint: true },
    limit: { key: "projects.mcp.read", max: 30, windowMs: 60_000 }, audit: { action: "exec.run" as const, targetArg: "project" },
    inputSchema: S({ project: { type: "string" }, deployment: { type: "string" } }, ["project"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      return { project: { id: project.id, name: project.name }, deployment: databaseDeployment(a), provider: "convex", tools: await listProjectConvexTools(project.path, databaseDeployment(a)) };
    },
  },
  {
    name: "project_database_call",
    title: "Call Convex Database Tool",
    description: "Call one supported official Convex MCP tool for the selected project. Dynamic arguments must match project_database_tools. MSO removes projectDir overrides and refuses cross-project deployment selectors; Convex production PII/write restrictions remain fail-closed because MSO never enables dangerous production flags automatically.",
    scope: "exec", annotations: { destructiveHint: true, openWorldHint: true, idempotentHint: false },
    limit: { key: "projects.mcp.call", max: 30, windowMs: 60_000 }, audit: { action: "exec.run" as const, targetArg: "tool" },
    result: { maxTextBytes: 96 * 1024, overflowHint: "Convex result was compacted; use a narrower query or table/function target." },
    inputSchema: S({
      project: { type: "string" }, deployment: { type: "string" }, tool: { type: "string" },
      arguments: { type: "object", additionalProperties: true, description: "Arguments from project_database_tools." },
    }, ["project", "tool"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      return { project: { id: project.id, name: project.name }, provider: "convex", tool: str(a, "tool"), result: await callProjectConvexTool(project.path, str(a, "tool"), a.arguments ?? {}, databaseDeployment(a)) };
    },
  },
  {
    name: "project_database_query",
    title: "Query Convex Database",
    description: "Run Convex's official read-only runOneoffQuery MCP capability for the selected project. This is JavaScript/Convex query semantics, not SQL. Pass arguments matching the current runOneoffQuery schema returned by project_database_tools.",
    scope: "exec", annotations: { destructiveHint: false, openWorldHint: true, idempotentHint: true },
    limit: { key: "projects.mcp.read", max: 30, windowMs: 60_000 }, audit: { action: "exec.run" as const, targetArg: "project" },
    result: { maxTextBytes: 96 * 1024, overflowHint: "Convex query result was compacted; narrow the query." },
    inputSchema: S({
      project: { type: "string" }, deployment: { type: "string" }, arguments: { type: "object", additionalProperties: true },
    }, ["project", "arguments"]),
    run: async (a) => {
      const project = await selectedProject(str(a, "project"));
      return { project: { id: project.id, name: project.name }, provider: "convex", tool: "runOneoffQuery", result: await callProjectConvexTool(project.path, "runOneoffQuery", a.arguments, databaseDeployment(a)) };
    },
  },
  {
    name: "project_agent_run",
    title: "Send Project Agent Message",
    description: "Send one focused task to MSO's existing project subagent runtime. wait=true (default) returns the bounded result; wait=false returns message_id immediately and project_agent_status can retrieve it. Plan mode forces read-only. Task records are durable and client-owned; the execution worker remains bounded to the current MSO service lifecycle.",
    scope: "exec", annotations: { destructiveHint: true, openWorldHint: true, idempotentHint: false },
    limit: { key: "agent.subagent", max: 12, windowMs: 60_000 }, audit: { action: "agent.subagent" as const, targetArg: "project" },
    inputSchema: S({
      project: { type: "string" }, message: { type: "string", minLength: 1, maxLength: 100000 },
      wait: { type: "boolean", description: "Wait for completion. Default true; false returns message_id immediately." },
      plan_mode: { type: "boolean", description: "When true, force read-only planning and prohibit edits." },
      max_scope: { type: "string", enum: ["read", "write", "exec"], description: "Default write for build mode, read for plan mode." },
      max_turns: { type: "number", minimum: 1, maximum: 48 }, timeout_ms: { type: "number", minimum: 1000, maximum: 120000 },
    }, ["project", "message"]),
    run: async (a, context) => {
      if (!context.principal || !context.sessionId) throw new Error("project agent requires a conversation-bound MSO session");
      const project = await selectedProject(str(a, "project"));
      const requested = parseScope(a.plan_mode === true ? "read" : (opt(a, "max_scope") ?? "write"));
      if (!allows(context.scope, requested)) throw new Error(`project agent max_scope ${requested} exceeds caller scope ${context.scope}`);
      const message = str(a, "message"), planMode = a.plan_mode === true;
      const task = await createProjectAgentTask({ principal: context.principal, sessionId: context.sessionId, project: { id: project.id, name: project.name }, planMode, maxScope: requested });
      const execute = async () => {
        try {
          const mode = planMode ? "PLAN ONLY: inspect and propose; do not edit." : "Implement the requested project work and verify it within the delegated scope.";
          const result = await runSessionSubagent({
            principal: context.principal!, parentSessionId: context.sessionId!, name: `project-${project.name}`,
            objective: `${mode}\nSelected project: ${project.path}\nUser task: ${message}`, maxScope: requested,
            maxTurns: typeof a.max_turns === "number" ? a.max_turns : undefined, timeoutMs: typeof a.timeout_ms === "number" ? a.timeout_ms : undefined,
            explicitContext: `Project id=${project.id}; path=${project.path}. Stay focused on this project.`,
          });
          return updateProjectAgentTask(context.principal!, task.id, {
            status: result.status,
            result: { text: result.text, subagentId: result.subagentId, rounds: result.rounds, toolCalls: result.toolCalls },
          });
        } catch (error) {
          return updateProjectAgentTask(context.principal!, task.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
      };
      if (a.wait === false) { void execute(); return { message_id: task.id, project: task.project, status: "in_progress", created_at: task.createdAt }; }
      const completed = await execute();
      return { message_id: completed.id, project: completed.project, status: completed.status, created_at: completed.createdAt, updated_at: completed.updatedAt, result: completed.result, error: completed.error };
    },
  },
  {
    name: "project_agent_status",
    title: "Get Project Agent Message",
    description: "Get the status/result of one project_agent_run message owned by this authenticated MSO client. in_progress means the bounded worker is still running; completed/partial/timeout/failed are terminal.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: S({ message_id: { type: "string", description: "message_id returned by project_agent_run." } }, ["message_id"]),
    run: async (a, context) => {
      if (!context.principal) throw new Error("project agent status requires an authenticated MSO client");
      const task = await getProjectAgentTask(context.principal, str(a, "message_id"));
      if (!task) throw new Error("project agent message not found for this client");
      return { message_id: task.id, project: task.project, status: task.status, plan_mode: task.planMode, max_scope: task.maxScope, created_at: task.createdAt, updated_at: task.updatedAt, result: task.result, error: task.error };
    },
  },
];

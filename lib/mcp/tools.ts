import { writeFileGuarded, makeDir, remove, move, copy, runCommand, startExecJob, getExecJob, cancelExecJob, resolveProjectHint, runProjectFunction } from "@/lib/host";
import { type McpTool, str, opt, S, PATH_P } from "./tool-kit";
import { importOpenAiProvidedFile } from "./openai-file-upload";
import { READ_TOOLS } from "./tools-read";
import { DISCOVERY_TOOLS } from "./tools-discovery";
import { LEARNING_TOOLS } from "./tools-learning";
import { POWER_TOOLS } from "./tools-power";
import { INFRA_TOOLS } from "./tools-infra";
import { AGENT_TOOLS } from "./tools-agent";
import { A2A_TOOLS } from "./tools-a2a";
import { LOCAL_AGENT_TOOLS } from "./tools-local-agents";
import { SUBAGENT_TOOLS } from "./tools-subagents";
import { FORGE_TOOLS } from "./tools-forge";
import { withWorkflowContext } from "./tool-context";

// The write and exec tiers. Each carries an `audit` descriptor — the dispatcher,
// not the tool, writes the trail, because these call lib/host directly and so
// never pass the route-layer audit that covers /api/v1.
const MUTATE_TOOLS: McpTool[] = [
  {
    name: "fs_write",
    limit: { key: "fs.write", max: 120, windowMs: 60_000 },
    audit: { action: "fs.write" as const, targetArg: "path" },
    description:
      "Create or overwrite a text file on the VPS. Inspect with fs_read first and pass its SHA-256 as expected_sha256 " +
      "to refuse a stale overwrite when another process changed the file. Omitting the hash keeps legacy overwrite behaviour. " +
      "Bounded to OS_FS_WRITE_ROOTS (home + ~/projects by default).",
    scope: "write",
    annotations: { idempotentHint: true },
    inputSchema: S({
      ...PATH_P,
      content: { type: "string" },
      expected_sha256: { type: "string", description: "Optional SHA-256 returned by fs_read; refuse if the current file no longer matches." },
    }, ["path", "content"]),
    run: async (a) => ({ ok: true, ...(await writeFileGuarded({
      path: str(a, "path"),
      content: typeof a.content === "string" ? a.content : "",
      expectedSha256: opt(a, "expected_sha256"),
    })) }),
  },
  {
    name: "fs_upload_file",
    limit: { key: "fs.upload", max: 20, windowMs: 60_000 },
    audit: { action: "fs.upload" as const, targetArg: "dest" },
    description:
      "Import one ChatGPT conversation/generated file into an existing VPS directory. " +
      "ChatGPT binds the top-level file parameter through openai/fileParams, MSO downloads the temporary OpenAI URL immediately, validates the host/type/size, writes within OS_FS_WRITE_ROOTS, and returns byte count plus SHA-256. Existing same-name files may be replaced.",
    scope: "write",
    annotations: { destructiveHint: true, openWorldHint: true },
    meta: { "openai/fileParams": ["file"] },
    inputSchema: S({
      file: {
        type: "object",
        description: "ChatGPT-provided file reference. Select or attach exactly one generated/uploaded image.",
        properties: {
          download_url: { type: "string" },
          file_id: { type: "string" },
          mime_type: { type: "string" },
          file_name: { type: "string" },
          name: { type: "string" },
          size: { type: "number" },
        },
        required: ["download_url", "file_id"],
        additionalProperties: true,
      },
      dest: { type: "string", description: "Existing destination directory on the VPS, within OS_FS_WRITE_ROOTS." },
      filename: { type: "string", description: "Optional safe destination basename; defaults to the ChatGPT filename." },
    }, ["file", "dest"]),
    run: async (a) => importOpenAiProvidedFile({
      file: a.file,
      dest: str(a, "dest"),
      filename: opt(a, "filename"),
    }),
  },
  {
    name: "fs_mkdir",
    limit: { key: "fs.mkdir", max: 120, windowMs: 60_000 },
    audit: { action: "fs.mkdir" as const, targetArg: "path" },
    description: "Create a directory (and any missing parents) on the VPS.",
    scope: "write",
    annotations: { idempotentHint: true },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => { await makeDir(str(a, "path")); return { ok: true, path: a.path }; },
  },
  {
    name: "fs_move",
    limit: { key: "fs.move", max: 120, windowMs: 60_000 },
    audit: { action: "fs.move" as const, targetArg: "from" },
    description: "Move or rename a file or directory. Refuses when the source holds credential paths.",
    scope: "write",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
    run: async (a) => { await move(str(a, "from"), str(a, "to")); return { ok: true }; },
  },
  {
    name: "fs_copy",
    limit: { key: "fs.copy", max: 60, windowMs: 60_000 },
    audit: { action: "fs.copy" as const, targetArg: "from" },
    description: "Copy a file or directory. The cockpit's own secrets are skipped rather than duplicated.",
    scope: "write",
    inputSchema: S({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]),
    run: async (a) => { await copy(str(a, "from"), str(a, "to")); return { ok: true }; },
  },
  {
    name: "fs_delete",
    limit: { key: "fs.delete", max: 60, windowMs: 60_000 },
    audit: { action: "fs.delete" as const, targetArg: "path" },
    description:
      "Delete a file or directory on the VPS. PERMANENT — there is no trash and no undo. " +
      "Confirm with the user before calling this on anything you did not create in this conversation.",
    scope: "write",
    annotations: { destructiveHint: true },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => { await remove(str(a, "path")); return { ok: true, path: a.path }; },
  },

  {
    name: "project_function_call",
    limit: { key: "projects.function", max: 60, windowMs: 60_000 },
    audit: {
      action: "exec.run" as const,
      targetArg: "project",
      outcome: (r) => {
        const { code } = r as { code: number };
        return { ok: code === 0, action: "exec.run", detail: `project function exit ${code}` };
      },
    },
    description:
      "Execute ONE function explicitly declared by a validated project's .mso/functions.json. " +
      "This is project code execution and therefore requires exec scope. The manifest supplies fixed argv; model/user input is passed only as JSON on stdin and is NEVER interpolated into a shell command. " +
      "Call project_capabilities first for function names and schemas. Projects without an opt-in manifest expose nothing.",
    scope: "exec",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: S({
      project: { type: "string", description: "Exact project id from projects_list, absolute path, name or alias." },
      name: { type: "string", description: "Function name returned by project_capabilities." },
      input: { type: "object", description: "JSON object passed to the project function on stdin.", additionalProperties: true },
    }, ["project", "name", "input"]),
    run: async (a) => {
      const project = await resolveProjectHint(str(a, "project"));
      if (!project) throw new Error(`project not found: ${String(a.project)}`);
      return runProjectFunction(project.path, str(a, "name"), a.input);
    },
  },
  {
    name: "exec_job_start",
    limit: { key: "exec.job.start", max: 12, windowMs: 60_000 },
    audit: {
      action: "exec.job.start" as const,
      targetArg: "command",
      outcome: (r) => {
        const row = r as { state: string };
        const refused = row.state === "refused";
        return { ok: !refused, action: refused ? "exec.blocked" : "exec.job.start", detail: refused ? "refused" : "started" };
      },
    },
    description:
      "Start one bounded asynchronous shell job for legitimate test/build pipelines that exceed exec_run's 30s request budget. " +
      "The job is client/workflow-bound, capped at 20 minutes and 1 MiB per output stream, limited to four concurrent jobs per client, and uses the same cwd jail and catastrophic-command filter as exec_run. Use exec_job_status to read it and exec_job_cancel to stop it.",
    scope: "exec",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: S({
      command: { type: "string", description: "The shell command line to run asynchronously." },
      cwd: { type: "string", description: "Working directory. Defaults to the owner's home." },
    }, ["command"]),
    run: (a, context) => startExecJob({
      command: str(a, "command"), cwd: opt(a, "cwd"), actor: context.workflowActor ?? context.actor, workflowId: context.workflowId,
    }),
  },
  {
    name: "exec_job_status",
    limit: { key: "exec.job.status", max: 120, windowMs: 60_000 },
    description:
      "Read one asynchronous exec job owned by this MCP client. Returns state, bounded stdout/stderr, exit code when finished, and whether output was truncated.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    result: { maxTextBytes: 64 * 1024, overflowHint: "The job output is larger than the model context budget; rerun a focused grep/tail after completion if more detail is needed." },
    inputSchema: S({ job_id: { type: "string", description: "Exact id returned by exec_job_start." } }, ["job_id"]),
    run: (a, context) => Promise.resolve(getExecJob(str(a, "job_id"), context.workflowActor ?? context.actor, context.workflowId)),
  },
  {
    name: "exec_job_cancel",
    limit: { key: "exec.job.cancel", max: 30, windowMs: 60_000 },
    audit: { action: "exec.job.cancel" as const, targetArg: "job_id" },
    description:
      "Cancel one still-running asynchronous exec job owned by this MCP client. Repeated cancellation is idempotent.",
    scope: "exec",
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: S({ job_id: { type: "string", description: "Exact id returned by exec_job_start." } }, ["job_id"]),
    run: (a, context) => Promise.resolve(cancelExecJob(str(a, "job_id"), context.workflowActor ?? context.actor, context.workflowId)),
  },
  {
    name: "exec_run",
    limit: { key: "exec", max: 60, windowMs: 60_000 },
    audit: {
      action: "exec.run" as const,
      targetArg: "command",
      // runCommand REFUSES by returning {code:126, stderr:"refused: …"}, it does not
      // throw — so "the handler did not throw" is not success here. Mirrors
      // app/api/v1/exec/run/route.ts:39-45 exactly; the two must not disagree about
      // what the same command did.
      outcome: (r) => {
        const { code, stderr } = r as { code: number; stderr: string };
        const blocked = code === 126 && stderr.startsWith("refused:");
        return { ok: !blocked && code === 0, action: blocked ? "exec.blocked" : "exec.run", detail: `exit ${code}` };
      },
    },
    description:
      "Run a shell command on the VPS as the owner and return stdout, stderr and exit code. " +
      "FULL HOST POWER — prefer fs_* and sys_* tools whenever they cover the task; they are bounded and " +
      "this is not. Catastrophic patterns (rm -rf /, fork bombs, disk wipes) are refused by the server. " +
      "Long-running or interactive commands will time out: this is not a terminal session.",
    scope: "exec",
    annotations: { destructiveHint: true, openWorldHint: true },
    result: { maxTextBytes: 48 * 1024, overflowHint: "Command output was compacted; rerun a narrower command (grep/head/tail) for the omitted evidence." },
    inputSchema: S({
      command: { type: "string", description: "The shell command line to run." },
      cwd: { type: "string", description: "Working directory. Defaults to the owner's home." },
    }, ["command"]),
    run: (a) => runCommand(str(a, "command"), opt(a, "cwd")),
  },
];

export const TOOLS: McpTool[] = [...READ_TOOLS, ...DISCOVERY_TOOLS, ...LEARNING_TOOLS, ...AGENT_TOOLS, ...LOCAL_AGENT_TOOLS, ...SUBAGENT_TOOLS, ...A2A_TOOLS, ...FORGE_TOOLS, ...INFRA_TOOLS, ...MUTATE_TOOLS, ...POWER_TOOLS].map(withWorkflowContext); export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

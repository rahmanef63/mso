import { api, C } from "./mso-agent-runtime.mjs";
import { executeTool } from "./mso-agent-turn.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

export function formatElapsed(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function getJobElapsed(job, now = Date.now()) {
  if (job.status === "running" && job.startedAt) {
    const start = Date.parse(job.startedAt);
    if (!Number.isNaN(start)) return Math.max(0, now - start);
  }
  if (typeof job.elapsedMs === "number" && !Number.isNaN(job.elapsedMs)) return Math.max(0, job.elapsedMs);
  if (job.startedAt) {
    const start = Date.parse(job.startedAt);
    const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
    if (!Number.isNaN(start) && !Number.isNaN(end)) return Math.max(0, end - start);
  }
  return 0;
}

export function parseJobsResult(result) {
  if (result == null) return [];
  let parsed = result;
  if (typeof result === "string") {
    try { parsed = JSON.parse(result); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const jobs = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const jobId = typeof item.jobId === "string" ? item.jobId : (typeof item.job_id === "string" ? item.job_id : "");
    if (!jobId) continue;
    const clean = {
      jobId,
      status: typeof item.status === "string" ? item.status : "unknown",
      name: typeof item.name === "string" && item.name ? item.name : "worker",
      startedAt: typeof item.startedAt === "string" ? item.startedAt : "",
      ...(typeof item.finishedAt === "string" ? { finishedAt: item.finishedAt } : {}),
      elapsedMs: typeof item.elapsedMs === "number" && !Number.isNaN(item.elapsedMs) ? Math.max(0, item.elapsedMs) : 0,
    };
    if (typeof item.resultPreview === "string") clean.resultPreview = item.resultPreview;
    if (typeof item.result === "string") clean.result = item.result;
    if (typeof item.error === "string") clean.error = item.error;
    jobs.push(clean);
  }
  return jobs;
}

export function parseJobResult(result) {
  if (result == null) return null;
  let parsed = result;
  if (typeof result === "string") {
    try { parsed = JSON.parse(result); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const jobId = typeof parsed.jobId === "string" ? parsed.jobId : (typeof parsed.job_id === "string" ? parsed.job_id : "");
  if (!jobId) return null;
  return {
    jobId,
    status: typeof parsed.status === "string" ? parsed.status : "unknown",
    name: typeof parsed.name === "string" && parsed.name ? parsed.name : "worker",
    startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    ...(typeof parsed.finishedAt === "string" ? { finishedAt: parsed.finishedAt } : {}),
    ...(parsed.result !== undefined ? { result: String(parsed.result) } : {}),
    ...(parsed.error !== undefined ? { error: String(parsed.error) } : {}),
    elapsedMs: typeof parsed.elapsedMs === "number" && !Number.isNaN(parsed.elapsedMs) ? Math.max(0, parsed.elapsedMs) : 0,
  };
}

export function formatJobsBlock(jobs, { colors = {}, maxItems = 12, now = Date.now() } = {}) {
  const items = Array.isArray(jobs) ? jobs : parseJobsResult(jobs);
  if (!items.length) return "no background subagent jobs found";
  const { dim = "", reset = "", c: accent = colors?.cyan || "", err = "", warn = "" } = colors;
  const effectiveMax = typeof maxItems === "number" && maxItems >= 0 ? maxItems : 12;
  const lines = items.slice(0, effectiveMax).map((job) => {
    const call = dim ? `${dim}${job.jobId || "unknown"}${reset}` : (job.jobId || "unknown");
    const elapsed = dim ? `${dim}${formatElapsed(getJobElapsed(job, now))}${reset}` : formatElapsed(getJobElapsed(job, now));
    const s = job.status || "unknown";
    let state = s;
    if (reset) {
      if (s === "completed" || s === "running") state = `${accent}${s}${reset}`;
      else if (s === "failed") state = `${err}${s}${reset}`;
      else if (s === "cancelled") state = `${warn}${s}${reset}`;
      else if (s === "expired") state = `${dim}${s}${reset}`;
    }
    return `  ${call}  ${state}  ${job.name || "worker"}  ${elapsed}`;
  });
  if (items.length > effectiveMax) {
    const text = `… ${items.length - effectiveMax} more jobs`;
    lines.push(`  ${dim ? `${dim}${text}${reset}` : text}`);
  }
  return lines.join("\n");
}

export function formatJobDetail(job, { colors = {}, now = Date.now() } = {}) {
  if (!job) return "job not found";
  const { dim = "", reset = "", bold = "" } = colors;
  const lines = [
    `Job:      ${job.jobId}`,
    `Status:   ${job.status}`,
    `Name:     ${job.name}`,
    `Elapsed:  ${formatElapsed(getJobElapsed(job, now))}`,
  ];
  if (job.startedAt) lines.push(`Started:  ${dim}${job.startedAt}${reset}`);
  if (job.finishedAt) lines.push(`Finished: ${dim}${job.finishedAt}${reset}`);
  if (job.status === "completed" && job.result !== undefined) lines.push("", `${bold}Result:${reset}`, job.result);
  if (job.status === "failed" && job.error !== undefined) lines.push("", `${bold}Error:${reset}`, job.error);
  return lines.join("\n");
}

export function printJobs(jobs, { colors, maxItems, print, now, session } = {}) {
  const formatted = formatJobsBlock(jobs, { colors, maxItems, now });
  const doPrint = print || createPrinter({ session, colors }).printBlock;
  doPrint(formatted);
  return formatted;
}

export async function handleJobsCommand(ctx, args = []) {
  const { api: request = api, session, rl, C: colors = C } = ctx;
  const { print, printBlock } = createPrinter(ctx);
  const sessionId = session?.agentSession?.id;
  const subcommand = args[0];

  if (!subcommand) {
    try {
      const out = await request("/api/v1/agent-tools", {
        method: "POST",
        body: JSON.stringify({ name: "agent_subagent_status", input: {}, ...(sessionId ? { sessionId } : {}) }),
      });
      if (!out?.ok) {
        console.error(`${colors.err || ""}${out?.result || "could not list subagent jobs"}${colors.reset || ""}`);
        return "handled";
      }
      printJobs(parseJobsResult(out.result), { colors, print: printBlock, session });
    } catch (err) {
      console.error(`${colors.err || ""}${err instanceof Error ? err.message : String(err)}${colors.reset || ""}`);
    }
    return "handled";
  }

  if (subcommand === "cancel") {
    const jobId = args[1]?.trim();
    if (!jobId) { print("usage: /jobs cancel <id>"); return "handled"; }
    if (!sessionId) { print("cannot cancel: active agent session required for tool approval"); return "handled"; }
    try {
      const tool = session?.state?.tools?.find((t) => t.name === "agent_subagent_cancel") || { name: "agent_subagent_cancel", scope: "exec" };
      const call = { id: `slash_cancel_${Date.now()}`, name: "agent_subagent_cancel", input: { job_id: jobId } };
      const outcome = await executeTool(rl, tool, call, session.agentSession, session.permission, undefined, null, { approvalState: session });
      if (!outcome?.ok) { print(outcome?.result || "cancel failed"); return "handled"; }
      const job = parseJobResult(outcome.result);
      if (job) printBlock(formatJobDetail(job, { colors }));
      else print(outcome.result || "job cancelled");
    } catch (err) {
      console.error(`${colors.err || ""}${err instanceof Error ? err.message : String(err)}${colors.reset || ""}`);
    }
    return "handled";
  }

  const jobId = subcommand.trim();
  try {
    const out = await request("/api/v1/agent-tools", {
      method: "POST",
      body: JSON.stringify({ name: "agent_subagent_status", input: { job_id: jobId }, ...(sessionId ? { sessionId } : {}) }),
    });
    if (!out?.ok) {
      console.error(`${colors.err || ""}${out?.result || `job ${jobId} not found`}${colors.reset || ""}`);
      return "handled";
    }
    const job = parseJobResult(out.result);
    if (job) printBlock(formatJobDetail(job, { colors }));
    else print(out.result || `job ${jobId} not found`);
  } catch (err) {
    console.error(`${colors.err || ""}${err instanceof Error ? err.message : String(err)}${colors.reset || ""}`);
  }
  return "handled";
}

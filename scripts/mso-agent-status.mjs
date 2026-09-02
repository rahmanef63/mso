import os from "node:os";
import path from "node:path";
import { projectHistoryForModel } from "./mso-agent-context.mjs";

function compactNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function estimateTokens(value) {
  // Provider-neutral fallback. ~4 UTF-8 bytes/token is intentionally labeled with
  // `~` in the UI; actual usage from a provider replaces cumulative estimates.
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(0, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

function historyContextEstimate(history) {
  return (Array.isArray(history) ? history : []).reduce((sum, row) => sum + estimateTokens(row), 0);
}

export function contextStatus(history, modelMeta) {
  const limit = Number(modelMeta?.context || 0);
  const projected = projectHistoryForModel(history, limit);
  return {
    used: projected.estimatedTokens,
    stored: historyContextEstimate(history),
    omittedRows: projected.omittedRows,
    budget: projected.budgetTokens,
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    percent: limit > 0 ? Math.min(999, Math.round((projected.estimatedTokens / limit) * 100)) : null,
  };
}

export function addUsage(total, next) {
  const base = total || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  if (!next || typeof next !== "object") return base;
  const input = Number(next.inputTokens ?? next.input_tokens ?? 0) || 0;
  const output = Number(next.outputTokens ?? next.output_tokens ?? 0) || 0;
  const explicit = Number(next.totalTokens ?? next.total_tokens ?? 0) || 0;
  return {
    inputTokens: base.inputTokens + input,
    outputTokens: base.outputTokens + output,
    totalTokens: base.totalTokens + (explicit || input + output),
  };
}


function compactLabel(value, max = 28) {
  const clean = String(value || "MSO Agent session").replace(/[\r\n\t]+/g, " ").trim();
  const row = Array.from(clean);
  return row.length <= max ? clean : `${row.slice(0, Math.max(1, max - 1)).join("")}…`;
}

function homeShort(cwd) {
  const home = os.homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}${path.sep}`)) return `~/${path.relative(home, cwd)}`;
  return cwd;
}

function skillStatus(session) {
  if (session?.activeSkill?.name) return { state: "invoking", name: session.activeSkill.name };
  if (session?.pendingSkill?.name) return { state: "queued", name: session.pendingSkill.name };
  if (session?.lastInvokedSkill?.name) return { state: "invoked", name: session.lastInvokedSkill.name };
  return null;
}

export function statusParts(session, cwd = process.cwd()) {
  const provider = String(session?.state?.config?.provider || "—");
  const model = String(session?.state?.config?.model || "—");
  const ctx = contextStatus(session?.history, session?.state?.modelMeta);
  const turns = (session?.history || []).filter((row) => row?.role === "user").length;
  const sessionTitle = compactLabel(session?.agentSession?.title || "MSO Agent session");
  const sessionName = String(session?.agentSession?.name || "agent");
  const usage = session?.usage || { totalTokens: 0 };
  const elapsed = Number(session?.lastElapsedMs || 0);
  const skill = skillStatus(session);
  const routing = session?.lastRouting || null;
  return [
    `${provider}/${model}`,
    skill ? `skill ${skill.state === "invoked" ? "✓" : "◆"} /${skill.name}${skill.state === "queued" ? " queued" : skill.state === "invoking" ? " invoking" : ""}` : null,
    ctx.limit ? `ctx ~${compactNumber(ctx.used)}/${compactNumber(ctx.limit)} ${ctx.percent}%` : `ctx ~${compactNumber(ctx.used)}/?`,
    session?.agentSession?.compactThresholdTokens ? `session ~${compactNumber(session.agentSession.estimatedTokens)}/${compactNumber(session.agentSession.compactThresholdTokens)}` : null,
    usage.totalTokens > 0 ? `tokens ${compactNumber(usage.totalTokens)}` : null,
    routing?.activeTools != null ? `route ${routing.routeIds?.join("+") || (routing.fallbackUsed ? "fallback" : "direct")} · tools ${routing.activeTools}/${routing.fullTools}` : null,
    `turns ${turns}`,
    elapsed > 0 ? `${(elapsed / 1000).toFixed(elapsed >= 10_000 ? 0 : 1)}s` : null,
    `@${sessionName}`,
    `session ${sessionTitle}`,
    homeShort(cwd),
  ].filter(Boolean);
}


function detailedStatus(session, cwd = process.cwd()) {
  const cfg = session?.state?.config || {};
  const ctx = contextStatus(session?.history, session?.state?.modelMeta);
  const usage = session?.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const providerMeta = (cfg.providers || []).find((row) => row.id === cfg.provider);
  return {
    provider: cfg.provider || null,
    providerAuth: providerMeta?.kind || (cfg.hasApiKey ? "key/env" : "unknown"),
    model: cfg.model || null,
    contextEstimatedTokens: ctx.used,
    contextWindow: ctx.limit,
    contextPercent: ctx.percent,
    contextOmittedRows: ctx.omittedRows,
    sessionEstimatedTokens: Number(session?.agentSession?.estimatedTokens || ctx.stored || 0),
    sessionLifetimeEstimatedTokens: Number(session?.agentSession?.lifetimeEstimatedTokens || 0),
    sessionCompactThresholdTokens: Number(session?.agentSession?.compactThresholdTokens || 0),
    sessionCompactionCount: Number(session?.agentSession?.compactionCount || 0),
    sessionArchiveCount: Number(session?.agentSession?.archiveCount || 0),
    providerReportedUsage: usage,
    routing: session?.lastRouting || null,
    skill: skillStatus(session),
    turns: (session?.history || []).filter((row) => row?.role === "user").length,
    session: session?.agentSession?.id || null,
    name: session?.agentSession?.name || null,
    title: session?.agentSession?.title || null,
    permission: session?.permission || "ask",
    cwd: homeShort(cwd),
  };
}

export function printDetailedStatus(session, C, cwd = process.cwd()) {
  const row = detailedStatus(session, cwd);
  console.log(`${C.bold}MSO Agent status${C.reset}`);
  console.log(`  model      ${row.provider}/${row.model}`);
  console.log(`  auth       ${row.providerAuth}`);
  console.log(`  context    ~${row.contextEstimatedTokens}${row.contextWindow ? ` / ${row.contextWindow} (${row.contextPercent}%)` : " / ?"}${row.contextOmittedRows ? ` · ${row.contextOmittedRows} older rows projected out` : ""}`);
  if (row.sessionCompactThresholdTokens) console.log(`  session    ~${row.sessionEstimatedTokens} / ${row.sessionCompactThresholdTokens} stored · lifetime ~${row.sessionLifetimeEstimatedTokens} · ${row.sessionCompactionCount} compactions · ${row.sessionArchiveCount} archives`);
  if (row.providerReportedUsage.totalTokens > 0) {
    console.log(`  tokens     ${row.providerReportedUsage.totalTokens} total · ${row.providerReportedUsage.inputTokens} in · ${row.providerReportedUsage.outputTokens} out`);
  } else console.log("  tokens     provider has not reported usage in this process; context remains estimated");
  if (row.skill) console.log(`  skill      ${row.skill.state} /${row.skill.name}`);
  console.log(`  permission ${row.permission}`);
  console.log(`  turns      ${row.turns}`);
  console.log(`  session    ${row.session}`);
  console.log(`  name       @${row.name || "agent"}`);
  console.log(`  title      ${row.title || "MSO Agent session"}`);
  console.log(`  cwd        ${row.cwd}`);
}

import os from "node:os";
import path from "node:path";
import { projectHistoryForModel } from "./mso-agent-context.mjs";
import { addProviderUsage } from "../lib/ai/provider-usage.mjs";
import { todoStatusChip } from "./mso-agent-todos.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

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

export function addUsage(total, next) { return addProviderUsage(total, next); }


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

// Resolves status verbosity level: "low", "medium", or "high" (default).
// Falls back to "high" for unknown values so footer rendering never breaks.
export function resolveVerbosity(session, options = {}) {
  const raw = options?.verbosity || session?.verbosity || session?.statusVerbosity;
  const v = String(raw || "").toLowerCase().trim();
  if (v === "low" || v === "medium") return v;
  return "high";
}

export function statusParts(session, cwd = process.cwd(), options = {}) {
  const opts = (typeof cwd === "object" && cwd !== null) ? cwd : options;
  const targetCwd = (typeof cwd === "string" && cwd !== process.cwd()) ? cwd : (session?.cwd || cwd);
  const verbosity = resolveVerbosity(session, opts);
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
  // Mid-conversation situational awareness prioritizes mode, context usage,
  // and turn count. Working directory is static context that clutters narrow
  // viewports, so "medium" drops cwd first. Model and provider are also static,
  // so "low" drops provider/model and cwd while preserving live context and turns.
  const showModel = verbosity !== "low";
  const showCwd = verbosity === "high";
  return [
    showModel ? `${provider}/${model}` : null,
    skill ? `skill ${skill.state === "invoked" ? "✓" : "◆"} /${skill.name}${skill.state === "queued" ? " queued" : skill.state === "invoking" ? " invoking" : ""}` : null,
    ctx.limit ? `ctx ~${compactNumber(ctx.used)}/${compactNumber(ctx.limit)} ${ctx.percent}%` : `ctx ~${compactNumber(ctx.used)}/?`,
    session?.agentSession?.compactThresholdTokens ? `session ~${compactNumber(session.agentSession.estimatedTokens)}/${compactNumber(session.agentSession.compactThresholdTokens)}` : null,
    (usage.totalTokens ?? 0) > 0 ? `tokens ${compactNumber(usage.totalTokens)}`
      : ((usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0) ? `tokens ${compactNumber(usage.inputTokens)}in/${compactNumber(usage.outputTokens)}out` : null,
    routing?.activeTools != null ? `route ${routing.routeIds?.join("+") || (routing.fallbackUsed ? "fallback" : "direct")} · tools ${routing.activeTools}/${routing.fullTools}` : null,
    `turns ${turns}`,
    todoStatusChip(),
    elapsed > 0 ? `${(elapsed / 1000).toFixed(elapsed >= 10_000 ? 0 : 1)}s` : null,
    `@${sessionName}`,
    `session ${sessionTitle}`,
    showCwd ? homeShort(targetCwd) : null,
  ].filter(Boolean);
}


function detailedStatus(session, cwd = process.cwd()) {
  const cfg = session?.state?.config || {};
  const ctx = contextStatus(session?.history, session?.state?.modelMeta);
  const usage = session?.usage || { apiCalls: 0 };
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
    artifacts: session?.agentSession?.artifacts || null,
    permission: session?.permission || "ask",
    cwd: homeShort(cwd),
  };
}

export function printDetailedStatus(session, C, cwd = process.cwd(), options = {}) {
  const row = detailedStatus(session, cwd);
  const { print } = createPrinter({ session, colors: C, write: options?.print });
  print(`${C.bold}MSO Agent status${C.reset}`);
  print(`  model      ${row.provider}/${row.model}`);
  print(`  auth       ${row.providerAuth}`);
  print(`  context    ~${row.contextEstimatedTokens}${row.contextWindow ? ` / ${row.contextWindow} (${row.contextPercent}%)` : " / ?"}${row.contextOmittedRows ? ` · ${row.contextOmittedRows} older rows projected out` : ""}`);
  if (row.sessionCompactThresholdTokens) print(`  session    ~${row.sessionEstimatedTokens} / ${row.sessionCompactThresholdTokens} stored · lifetime ~${row.sessionLifetimeEstimatedTokens} · ${row.sessionCompactionCount} compactions · ${row.sessionArchiveCount} archives`);
  if ((row.providerReportedUsage.totalTokens ?? 0) > 0 || (row.providerReportedUsage.inputTokens ?? 0) > 0 || (row.providerReportedUsage.outputTokens ?? 0) > 0) {
    const u = row.providerReportedUsage;
    const parts = [
      u.totalTokens != null ? `${u.totalTokens} total` : null,
      u.inputTokens != null ? `${u.inputTokens} in` : null,
      u.outputTokens != null ? `${u.outputTokens} out` : null,
      u.cacheReadTokens != null ? `${u.cacheReadTokens} cache-read` : null,
      u.cacheWriteTokens != null ? `${u.cacheWriteTokens} cache-write` : null,
      u.reasoningTokens != null ? `${u.reasoningTokens} reasoning` : null,
      u.accountingMode ? `mode ${u.accountingMode}` : null,
    ].filter(Boolean);
    print(`  tokens     ${parts.join(" · ")}`);
  } else print("  tokens     provider has not reported usage in this process; context remains estimated");
  if (row.skill) print(`  skill      ${row.skill.state} /${row.skill.name}`);
  print(`  permission ${row.permission}`);
  print(`  turns      ${row.turns}`);
  print(`  session    ${row.session}`);
  print(`  name       @${row.name || "agent"}`);
  print(`  title      ${row.title || "MSO Agent session"}`);
  print(`  cwd        ${row.cwd}`);
  if (row.artifacts?.directory) print(`  temp       ${row.artifacts.directory}`);
  if (row.artifacts?.manifestPath) print(`  artifacts  ${row.artifacts.manifestPath}`);
}

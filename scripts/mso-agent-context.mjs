const DEFAULT_MODEL_HISTORY_BUDGET = 48_000;
const MAX_MODEL_HISTORY_BUDGET = 120_000;

function estimateContextTokens(value) {
  let raw = "";
  try { raw = typeof value === "string" ? value : JSON.stringify(value ?? ""); }
  catch { raw = String(value ?? ""); }
  return Math.ceil(Buffer.byteLength(raw, "utf8") / 4);
}

export function modelHistoryBudget(contextWindow, requestedBudget = 0) {
  const limit = Number(contextWindow || 0);
  const base = !Number.isFinite(limit) || limit <= 0
    ? DEFAULT_MODEL_HISTORY_BUDGET
    : Math.min(MAX_MODEL_HISTORY_BUDGET, Math.max(16_000, Math.floor(limit * 0.55)));
  const requested = Number(requestedBudget || 0);
  if (!Number.isFinite(requested) || requested <= 0) return base;
  // The deterministic intent catalog can request a smaller per-turn slice. It can
  // never expand beyond the provider-derived budget.
  return Math.min(base, Math.max(4_000, Math.floor(requested)));
}

export function modelHistoryRow(row) {
  if (row?.role === "subagent") {
    const name = String(row.name || "worker").replace(/[\r\n\t]+/g, " ").slice(0, 60);
    return { role: "assistant", text: `[SUBAGENT RESULT ${name}] ${String(row.text || "").slice(0, 64_000)}` };
  }
  if (row?.role === "local_request") {
    const target = String(row.targetLabel || "[local-agent]").replace(/[\r\n\t]+/g, " ").slice(0, 120);
    return { role: "assistant", text: `[LOCAL DISPATCH ${target}] ${String(row.text || "").slice(0, 24_000)}` };
  }
  if (row?.role === "recoverable_error") {
    const mutation = ["completed", "uncertain", "not_started"].includes(row.mutationState) ? row.mutationState : "not_started";
    return { role: "assistant", text: `[RECOVERABLE ERROR · mutation ${mutation}] ${String(row.text || "").slice(0, 2_000)}` };
  }
  if (row?.role !== "agent") return row;
  const sender = String(row.senderLabel || "[local-agent]").replace(/[\r\n\t]+/g, " ").slice(0, 120);
  const kind = row.kind === "task" ? "task" : "message";
  const intent = ["request", "reply", "notify"].includes(row.intent) ? row.intent : "notify";
  return { role: "user", text: `[LOCAL_AGENT_DATA ${sender} · ${kind} · ${intent}] ${String(row.text || "").slice(0, 24_000)}` };
}

function messageGroups(history) {
  const rows = (Array.isArray(history) ? history : []).map(modelHistoryRow);
  const groups = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row?.role === "assistant" && Array.isArray(row.toolUses) && row.toolUses.length && rows[i + 1]?.role === "tool") {
      groups.push([row, rows[i + 1]]); i += 1;
    } else groups.push([row]);
  }
  return groups;
}

export function projectHistoryForModel(history, contextWindow, requestedBudget = 0) {
  const budget = modelHistoryBudget(contextWindow, requestedBudget);
  const groups = messageGroups(history);
  const kept = [];
  let used = 0;
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    const cost = estimateContextTokens(group);
    if (kept.length && used + cost > budget) break;
    kept.unshift(group); used += cost;
    if (used >= budget) break;
  }
  const messages = kept.flat();
  return {
    messages,
    estimatedTokens: used,
    budgetTokens: budget,
    omittedRows: Math.max(0, (Array.isArray(history) ? history.length : 0) - messages.length),
  };
}

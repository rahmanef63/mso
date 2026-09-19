const DEFAULT_MODEL_HISTORY_BUDGET = 48_000;
const MAX_MODEL_HISTORY_BUDGET = 120_000;

function estimateContextTokens(value) {
  let raw = "";
  try { raw = typeof value === "string" ? value : JSON.stringify(value ?? ""); }
  catch { raw = String(value ?? ""); }
  return Math.ceil(Buffer.byteLength(raw, "utf8") / 4);
}


const MAX_REPLAY_HANDLES = 4;
const MAX_REPLAY_SCAN_NODES = 64;

function compactId(value, max = 512) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function compactReplayPath(value, max = 512) {
  const clean = compactId(value, max)
    .replace(/([?&](?:token|key|secret|password|code)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(?:bearer\s+)?(?:sk|pk|ghp|mso_mcp)_[a-z0-9_-]{8,}\b/gi, "[redacted]");
  return clean.includes("[redacted]") ? "" : clean;
}

function replayHandleKey(handle) {
  try { return JSON.stringify(handle); } catch { return String(handle?.kind || ""); }
}

function replayHandleFromCall(call) {
  const input = call?.input && typeof call.input === "object" ? call.input : {};
  const name = String(call?.name || "");
  if (typeof input.path === "string" && input.path.trim()) {
    return compactReplayPath(input.path) ? { kind: "file", path: compactReplayPath(input.path), rereadWith: name === "fs_read" ? "read_pipeline" : name } : null;
  }
  const jobId = compactId(input.job_id ?? input.jobId, 160);
  if (jobId) return { kind: "job", jobId, rereadWith: "exec_job_status" };
  const artifactId = compactId(input.artifact_id ?? input.artifactId, 160);
  if (artifactId) return { kind: "artifact", artifactId, rereadWith: "session_artifacts" };
  const cursor = compactId(input.cursor, 512);
  if (cursor) return { kind: "cursor", cursor, rereadWith: name === "project_candidate_search" ? "project_candidate_search" : name };
  return null;
}

function replayHandlesFromContent(content, call) {
  const out = [];
  const seen = new Set();
  const add = (handle) => {
    if (!handle || out.length >= MAX_REPLAY_HANDLES) return;
    const key = replayHandleKey(handle);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(handle);
  };
  add(replayHandleFromCall(call));

  const raw = String(content ?? "");
  let parsed;
  if (raw.length <= 128 * 1024 && /^[\s]*[\[{]/.test(raw)) {
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  }
  let nodes = 0;
  const visit = (value, depth = 0) => {
    if (out.length >= MAX_REPLAY_HANDLES || nodes >= MAX_REPLAY_SCAN_NODES || depth > 3 || value == null) return;
    nodes += 1;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 12)) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const pathValue = compactReplayPath(value.path, 512);
    const sha256 = compactId(value.sha256, 80);
    const cursor = compactId(value.cursor ?? value.nextCursor, 512);
    const jobId = compactId(value.job_id ?? value.jobId, 160);
    const artifactId = compactId(value.artifact_id ?? value.artifactId, 160);
    const truncated = value.truncated === true || value.msoTruncated === true;
    if (pathValue) add({
      kind: "file",
      path: pathValue,
      ...(/^[a-f0-9]{64}$/i.test(sha256) ? { sha256: sha256.toLowerCase() } : {}),
      ...(cursor ? { cursor } : {}),
      ...(truncated ? { truncated: true } : {}),
      rereadWith: "read_pipeline",
    });
    if (jobId) add({ kind: "job", jobId, rereadWith: "exec_job_status" });
    if (artifactId) add({ kind: "artifact", artifactId, rereadWith: "session_artifacts" });
    if (!pathValue && cursor) add({ kind: "cursor", cursor, ...(truncated ? { truncated: true } : {}), rereadWith: "project_candidate_search" });
    for (const [key, child] of Object.entries(value)) {
      if (["content", "stdout", "stderr", "text", "body", "data", "buffer", "bytes"].includes(key)) continue;
      if (child && typeof child === "object") visit(child, depth + 1);
      if (out.length >= MAX_REPLAY_HANDLES || nodes >= MAX_REPLAY_SCAN_NODES) break;
    }
  };
  visit(parsed);
  return out;
}

export function compactConsumedReadToolResults(history, tools) {
  if (!Array.isArray(history) || !Array.isArray(tools)) return 0;
  const scopes = new Map(tools.map((tool) => [String(tool?.name || ""), String(tool?.scope || "read")]));
  let compacted = 0;
  for (let index = 1; index < history.length; index += 1) {
    const row = history[index];
    const assistant = history[index - 1];
    if (row?.role !== "tool" || assistant?.role !== "assistant" || !Array.isArray(row.results) || !Array.isArray(assistant.toolUses)) continue;
    const calls = new Map(assistant.toolUses.map((call) => [String(call?.id || ""), call]));
    row.results = row.results.map((result) => {
      if (!result || typeof result !== "object" || result.msoReplay === true) return result;
      const call = calls.get(String(result.id || ""));
      if (!call || scopes.get(String(call.name || "")) !== "read") return result;
      const raw = String(result.content ?? "");
      const rawResultBytes = Buffer.byteLength(raw, "utf8");
      const handles = replayHandlesFromContent(raw, call);
      compacted += 1;
      return {
        id: result.id,
        isError: Boolean(result.isError),
        msoReplay: true,
        content: JSON.stringify({
          msoReplay: true,
          rawResultBytes,
          handles,
          ...(handles.length ? {} : { truncated: true }),
          instruction: handles.length
            ? "Re-read only the needed handle with the bounded read/status surface."
            : "The consumed read result was compacted. Re-run the exact prior read call only if details are needed.",
        }),
      };
    });
  }
  return compacted;
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

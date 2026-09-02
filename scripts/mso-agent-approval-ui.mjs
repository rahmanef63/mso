const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|credential|cookie|authorization|private[_-]?key)/i;
const SECRET_TEXT = /((?:api[_-]?key|token|secret|password|passwd|credential|authorization)\s*[=:]\s*)[^\s,;]+|\bBearer\s+[^\s,;]+/gi;

function oneLine(value, max = 100) {
  const clean = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const safe = clean.replace(SECRET_TEXT, (match, prefix) => prefix ? `${prefix}[redacted]` : "Bearer [redacted]");
  return Array.from(safe).length <= max ? safe : `${Array.from(safe).slice(0, Math.max(1, max - 1)).join("")}…`;
}

function safeValue(value, key = "", depth = 0) {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (depth > 3) return "[…]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return oneLine(value, 180);
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => safeValue(item, "", depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [childKey, child] of Object.entries(value).slice(0, 16)) out[childKey] = safeValue(child, childKey, depth + 1);
    return out;
  }
  return String(value ?? "");
}

export function approvalActionSummary(tool, input = {}) {
  const name = String(tool?.name || "tool");
  if (name === "exec_run" || name === "exec_job_start") return `run ${oneLine(input.command || "command", 72)}`;
  if (name === "fs_write") return `write ${oneLine(input.path || "file", 72)}`;
  if (name === "fs_delete") return `delete ${oneLine(input.path || "path", 72)}`;
  if (name === "fs_move") return `move ${oneLine(input.from || "source", 32)} → ${oneLine(input.to || "target", 32)}`;
  if (name === "fs_copy") return `copy ${oneLine(input.from || "source", 32)} → ${oneLine(input.to || "target", 32)}`;
  if (name === "apps_power") return `${oneLine(input.action || "change", 20)} ${oneLine(input.id || "app", 48)}`;
  if (name === "local_agent_message_send") return `message ${oneLine(input.target || "agent", 48)}`;
  return oneLine(name.replaceAll("_", " "), 80);
}

export function approvalArgsSummary(input = {}) {
  try { return JSON.stringify(safeValue(input)); }
  catch { return "{…}"; }
}

export function approvalStatusLine(tool, input, focused = false) {
  return `${focused ? "▸ " : ""}Approval needed: ${String(tool?.name || "tool")} — ${approvalActionSummary(tool, input)}`;
}

export function approvalDetailLines(tool, input, approval) {
  return [
    "Approval details",
    `  tool    ${String(tool?.name || "tool")}`,
    `  scope   ${String(tool?.scope || "write")}`,
    `  args    ${approvalArgsSummary(input)}`,
    `  digest  sha256 ${approval.digest}`,
    "  choose  allow or deny",
  ];
}

export async function requestExactToolApproval(rl, { tool, input = {}, approval, onCancel = null, signal = null, colors = {}, print = console.log }) {
  let focused = false;
  const dim = colors.dim || "", reset = colors.reset || "", blue = colors.blue || "", bold = colors.bold || "";
  const status = () => `${blue}${bold}${approvalStatusLine(tool, input, focused)}${reset}${dim}  · Tab focus · Enter details${reset} `;
  const opened = await rl.question(status, {
    history: false,
    onCancel,
    onTab: () => { focused = true; },
  });
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("turn interrupted");
  if (opened === null) return false;
  for (const line of approvalDetailLines(tool, input, approval)) print(line);
  const decision = String(await rl.question("  decision [allow/deny] › ", { history: false, onCancel }) ?? "").trim().toLowerCase();
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("turn interrupted");
  return decision === "allow";
}

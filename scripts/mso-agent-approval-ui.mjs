import { withPanelSuspended } from "./mso-agent-turn-print.mjs";
import { ApprovalSummaryFormatter } from "./mso-agent-approval-summary.mjs";

const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|credential|cookie|authorization|private[_-]?key)/i;
const SECRET_TEXT = /((?:api[_-]?key|token|secret|password|passwd|credential|authorization)\s*[=:]\s*)[^\s,;]+|\bBearer\s+[^\s,;]+/gi;

function redact(value) {
  return String(value ?? "").replace(SECRET_TEXT, (match, prefix) => prefix ? `${prefix}[redacted]` : "Bearer [redacted]");
}

function oneLine(value, max = 100) {
  const clean = redact(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(clean).length <= max ? clean : `${Array.from(clean).slice(0, Math.max(1, max - 1)).join("")}…`;
}

// A shell command is a SEQUENCE of lines, and flattening it is a lie with consequences: "a # note\nrm -f x"
// renders as one line where everything after "#" reads as a comment, so the approver approves something
// that looks harmless while the executor runs the second line. Each line is kept and numbered.
function commandLines(value, max = 120) {
  const lines = redact(value).split(/\r?\n/).map((line) => line.replace(/\t/g, "  ").replace(/\s+$/, ""));
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  const shown = lines.slice(0, 12);
  const out = shown.map((line, i) => (shown.length > 1 ? `${i + 1}│ ${clip(line, max)}` : clip(line, max)));
  if (lines.length > shown.length) out.push(`… +${lines.length - shown.length} more lines (run denied until shown in full)`);
  return out;
}

function clip(value, max) {
  const chars = Array.from(String(value ?? ""));
  return chars.length <= max ? chars.join("") : `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

function safeValue(value, key = "", depth = 0) {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (depth > 3) return "[…]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return oneLine(value, 180);
  if (Array.isArray(value)) {
    const shown = value.slice(0, 8).map((item) => safeValue(item, "", depth + 1));
    // Saying how many were withheld matters: an approver who sees 8 of 40 files is approving 8 files.
    return value.length > shown.length ? [...shown, `… +${value.length - shown.length} more`] : shown;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const out = {};
    for (const [childKey, child] of entries.slice(0, 16)) out[childKey] = safeValue(child, childKey, depth + 1);
    if (entries.length > 16) out["…"] = `+${entries.length - 16} more fields`;
    return out;
  }
  return String(value ?? "");
}

export function approvalActionSummary(tool, input = {}) {
  const name = String(tool?.name || "tool");
  if (name === "exec_run" || name === "exec_job_start") {
    const lines = commandLines(input.command ?? "command", 72);
    // A multi-line command says how many lines there are, so the one-line status cannot understate it.
    return lines.length > 1 ? `run ${lines[0]} (+${lines.length - 1} more lines)` : `run ${lines[0]}`;
  }
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
  const lines = [
    "Approval details",
    `  tool    ${String(tool?.name || "tool")}`,
    `  scope   ${String(tool?.scope || "write")}`,
  ];
  // A command gets one numbered row per line. The flattened JSON form comes after it, because that is
  // the shape the executor actually runs and the approver must see it in that shape.
  if (typeof input?.command === "string" && input.command.includes("\n")) {
    lines.push("  command");
    for (const row of commandLines(input.command, 100)) lines.push(`    ${row}`);
  }
  lines.push(`  args    ${approvalArgsSummary(input)}`);
  lines.push(`  digest  sha256 ${approval.digest}`);
  lines.push("  choose  allow or deny");
  return lines;
}

// Session-scoped approval formatter tracking confirmed tool calls in memory.
export const defaultApprovalSummaryFormatter = new ApprovalSummaryFormatter();

export async function requestExactToolApproval(rl, {
  tool,
  input = {},
  approval,
  onCancel = null,
  signal = null,
  colors = {},
  print = console.log,
  screenLoop = null,
  summaryFormatter = defaultApprovalSummaryFormatter,
}) {
  const loop = screenLoop || rl?.screenLoop;
  return withPanelSuspended(loop, async () => {
    // Print the summary line above the prompt to provide immediate context on repetition.
    if (summaryFormatter) {
      const summary = summaryFormatter.format(tool, input, approval);
      if (summary) print(summary);
    }
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
    const allowed = decision === "allow";
    // Only record approved calls when explicitly allowed by the operator.
    if (allowed && summaryFormatter && approval?.digest) {
      summaryFormatter.record(approval.digest);
    }
    return allowed;
  });
}

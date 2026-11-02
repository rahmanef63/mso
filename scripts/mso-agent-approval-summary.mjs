// Sanitizes target text to avoid escaping single-line TUI layouts or leaking credentials.
const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|credential|cookie|authorization|private[_-]?key)/i;
const SECRET_TEXT = /\b(?:authorization\s*:\s*)?bearer\s+[^\s,;]+|((?:api[_-]?key|token|secret|password|passwd|credential|authorization)\s*[=:]\s*)[^\s,;]+/gi;

function cleanTarget(value, max = 80) {
  // Normalize whitespace so multiline scripts do not push the prompt offscreen.
  const clean = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  // Strip sensitive tokens before printing to prevent terminal logs from leaking secrets.
  const safe = clean.replace(SECRET_TEXT, (match, prefix) => {
    if (prefix) return `${prefix}[redacted]`;
    if (/^authorization\s*:\s*bearer/i.test(match)) return "Authorization: Bearer [redacted]";
    return "Bearer [redacted]";
  });
  if (Array.from(safe).length <= max) return safe;
  return `${Array.from(safe).slice(0, Math.max(1, max - 1)).join("")}…`;
}

// Extracts the primary actionable target from tool input without guessing missing fields.
export function extractApprovalTarget(input = {}, tool = {}) {
  // Prefer explicit execution commands because they carry the highest risk profile.
  if (typeof input?.command === "string" && input.command.trim()) {
    return cleanTarget(input.command);
  }
  // File operations identify targets by path or source-destination pairs.
  if (typeof input?.path === "string" && input.path.trim()) {
    return cleanTarget(input.path);
  }
  if (typeof input?.from === "string" && typeof input?.to === "string") {
    return `${cleanTarget(input.from, 36)} -> ${cleanTarget(input.to, 36)}`;
  }
  // Named entities provide human-recognizable targets for messaging or agent operations.
  if (typeof input?.target === "string" && input.target.trim()) {
    return cleanTarget(input.target);
  }
  if (typeof input?.id === "string" && input.id.trim()) {
    return cleanTarget(input.id);
  }
  return "";
}

// Formats the human-readable repeat marker based on previous in-memory approvals.
export function approvalRepeatMarker(count) {
  const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  // Zero previous approvals means this is the first time the action is confirmed.
  if (n <= 0) return "";
  if (n === 1) return "approved once already";
  if (n === 2) return "approved twice already";
  return `approved ${n} times already`;
}

/**
 * Builds the single-line summary above the approval prompt.
 * @param {any} tool
 * @param {any} [input]
 * @param {any} [approval]
 * @param {number} [count]
 */
export function formatApprovalSummary(tool, input = {}, approval = undefined, count = 0) {
  const toolName = String(tool?.name || "tool");
  const target = extractApprovalTarget(input, tool);
  const marker = approvalRepeatMarker(count);

  // Omit the 64-character raw digest here because it clutters the single-line view.
  // Full digest details remain available in the expanded approvalDetailLines.
  if (target && marker) return `${toolName}: ${target} (${marker})`;
  if (target) return `${toolName}: ${target}`;
  if (marker) return `${toolName} (${marker})`;
  return toolName;
}

// In-memory, session-scoped tracker that binds approval repetition to canonical digests.
export class ApprovalSummaryFormatter {
  constructor() {
    // Session-scoped map ensures resumed sessions start empty and never claim phantom approvals.
    this.approvedCounts = new Map();
  }

  /**
   * Resolves the canonical hex digest from either a raw string or an approval object.
   * @param {any} digestOrApproval
   */
  resolveDigest(digestOrApproval) {
    if (typeof digestOrApproval === "string") return digestOrApproval;
    if (digestOrApproval && typeof digestOrApproval.digest === "string") {
      return digestOrApproval.digest;
    }
    return "";
  }

  /**
   * Returns how many times this exact digest has been approved during this process run.
   * @param {any} digestOrApproval
   */
  getCount(digestOrApproval) {
    const digest = this.resolveDigest(digestOrApproval);
    if (!digest) return 0;
    return this.approvedCounts.get(digest) || 0;
  }

  /**
   * Records a granted approval to alert the user if the exact same call reoccurs.
   * @param {any} digestOrApproval
   */
  record(digestOrApproval) {
    const digest = this.resolveDigest(digestOrApproval);
    if (!digest) return 0;
    const next = (this.approvedCounts.get(digest) || 0) + 1;
    this.approvedCounts.set(digest, next);
    return next;
  }

  /**
   * Convenience method that formats the summary using current session counts.
   * @param {any} tool
   * @param {any} [input]
   * @param {any} [approval]
   */
  format(tool, input = {}, approval = undefined) {
    const count = this.getCount(approval);
    return formatApprovalSummary(tool, input, approval, count);
  }

  // Explicit reset hook used when starting fresh turns or executing tests.
  clear() {
    this.approvedCounts.clear();
  }
}

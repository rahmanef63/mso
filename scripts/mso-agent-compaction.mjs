import { C } from "./mso-agent-runtime.mjs";

/**
 * Compact numeric formatting for token counts (e.g. 50000 -> 50k, 1200000 -> 1.2m).
 * Consistent with mso-agent-status.mjs compactNumber.
 */
export function compactNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/**
 * Formats the footer compaction chip with proximity and compaction awareness.
 * When usage exceeds 80% of threshold, gains warning tone.
 * When compacted at least once, indicates so briefly.
 * Preserves every field present in the default chip (~used/threshold).
 */
export function formatCompactionChip(session, options = {}) {
  const agentSession = session?.agentSession || session;
  const threshold = Number(agentSession?.compactThresholdTokens || 0);
  // Sessions without a compaction threshold cannot compact; return null to omit chip.
  if (!threshold || threshold <= 0) return null;
  const used = Number(agentSession?.estimatedTokens || 0);
  const count = Number(agentSession?.compactionCount || 0);
  const ratio = threshold > 0 ? used / threshold : 0;
  const percent = Math.min(999, Math.round(ratio * 100));
  // Proximity warning applies strictly above 80% of threshold to alert before context drop.
  const isWarn = ratio > 0.8;
  const colors = options?.colors || session?.colors || C;
  const warn = isWarn && colors?.warn ? colors.warn : "";
  const reset = warn ? (colors?.reset || "") : "";
  const proximity = isWarn ? ` ${percent}%` : "";
  // Brief indicator when compaction has run at least once to explain memory shifts.
  const compacted = count > 0 ? (count > 1 ? ` (compacted ${count}x)` : " (compacted)") : "";
  return `${warn}session ~${compactNumber(used)}/${compactNumber(threshold)}${proximity}${compacted}${reset}`;
}

/**
 * Formats a single transcript line announcing a compaction event.
 * Must name both the new compaction count and the threshold tokens.
 */
export function formatCompactionNotice({ count, threshold, colors = {} } = {}) {
  const thresholdText = compactNumber(threshold);
  const label = `[session compacted #${count} · threshold ${thresholdText}]`;
  // Muted styling keeps system telemetry distinguishable from agent or user prose.
  const tone = colors?.dim || "";
  const reset = tone ? (colors?.reset || "") : "";
  return `${tone}${label}${reset}`;
}

/**
 * Tracks session compaction count transitions across turns.
 * Emits exactly one notice line when count increases, and never on repaints.
 */
export class CompactionWatcher {
  /** @param {any} [initialSession] */
  constructor(initialSession = null) {
    this.lastSessionId = initialSession?.agentSession?.id || initialSession?.id || null;
    const rawCount = initialSession?.agentSession?.compactionCount ?? initialSession?.compactionCount;
    // Undefined indicates count was not available at start; avoids synthetic event on boot.
    this.lastCount = typeof rawCount === "number" ? rawCount : undefined;
    this.notices = [];
  }

  check(session, options = {}) {
    const agentSession = session?.agentSession || session;
    const currentId = agentSession?.id || null;
    const currentCount = agentSession?.compactionCount;
    // Session switches reset tracking so continuation does not falsely fire for past events.
    if (currentId && currentId !== this.lastSessionId) {
      this.lastSessionId = currentId;
      this.lastCount = typeof currentCount === "number" ? currentCount : undefined;
      this.notices = [];
      return null;
    }
    // If compactionCount is missing from the CLI session object, fall back silently.
    if (typeof currentCount !== "number") return null;
    // Initial baseline capture when count first becomes known.
    if (this.lastCount === undefined) {
      this.lastCount = currentCount;
      return null;
    }
    // Only an observed count increase represents a genuine compaction that occurred this turn.
    if (currentCount > this.lastCount) {
      const threshold = Number(agentSession?.compactThresholdTokens || 0);
      const notice = formatCompactionNotice({ count: currentCount, threshold, colors: options?.colors });
      this.notices.push(notice);
      this.lastCount = currentCount;
      return notice;
    }
    return null;
  }

  lines(colors = {}) {
    return [...this.notices];
  }

  reset() {
    this.notices = [];
    this.lastCount = undefined;
    this.lastSessionId = null;
  }
}

/** @param {any} [initialSession] */
export function createCompactionWatcher(initialSession = null) {
  return new CompactionWatcher(initialSession);
}

import process from "node:process";

/**
 * One-line live activity region for the interactive MSO Agent.
 *
 * The transcript is append-only, so every per-tool `[scope] / ↳ / ✓` line used to
 * claim a terminal row of its own and a 10-round turn buried the conversation. This
 * module owns a SINGLE row and repaints it in place (`\r` + erase-to-end-of-line),
 * the mechanism the composer already uses for its prompt: one `Agent work` section
 * plus one advancing row (`⠹ fs_search · 3/7 tools · 12s`) instead of a wall of rows.
 * When stdout is not a TTY nothing is animated and callers keep their discrete
 * lines, so pipes and log consumers never see cursor-control characters.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const DEFAULT_ACTIVITY_INTERVAL_MS = 120;
export const CLEAR_ACTIVITY_LINE = "\x1b[2K";

// The composer can repaint above an in-progress draft (async Local Agent traffic) at
// any moment. A suspended row is cleared first so a foreign write never lands inside
// the live row, then repainted on resume.
let current = null;

/** Clear any live activity row before a foreign writer touches stdout. */
export function suspendActiveActivity() {
  current?.suspend();
}

/** Repaint the live activity row after a foreign writer is done. */
export function resumeActiveActivity() {
  current?.resume();
}

export function formatElapsed(startedAt, now) {
  const elapsed = Math.max(0, Number(now) - Number(startedAt));
  if (elapsed < 1000) return "0s";
  const total = Math.floor(elapsed / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

/** Elapsed milliseconds as the compact `12s` / `1m04s` form used in the live row. */
export function formatDuration(ms) {
  return formatElapsed(0, ms);
}

/** Join non-empty segments with the same separator the status footer uses. */export function activityText(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("  ·  ");
}

/**
 * @typedef {object} AgentActivityOptions
 * @property {typeof process.stdout} [output] destination stream
 * @property {Record<string, string>} [colors] ANSI theme (subset of the agent palette)
 * @property {() => number} [now] clock injection for elapsed-time tests
 * @property {number} [intervalMs] spinner period
 * @property {boolean} [animate] force the live row on/off (defaults to `output.isTTY`)
 * @property {(line: string) => unknown} [print] discrete-line sink (defaults to console.log)
 * @property {typeof setInterval} [setIntervalImpl] timer injection
 * @property {typeof clearInterval} [clearIntervalImpl] timer injection
 */

export class AgentActivity {
  /** @param {AgentActivityOptions} [options] */
  constructor({
    output = process.stdout,
    colors = {},
    now = () => Date.now(),
    intervalMs = DEFAULT_ACTIVITY_INTERVAL_MS,
    animate = undefined,
    print = (line) => console.log(line),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
  } = {}) {
    this.output = output;
    this.C = colors;
    this.now = now;
    this.intervalMs = Math.max(40, Number(intervalMs) || DEFAULT_ACTIVITY_INTERVAL_MS);
    // Explicit `animate` wins so a PTY harness can force the live path.
    this.animate = animate === undefined ? Boolean(output?.isTTY) : Boolean(animate);
    this.print = print;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.frame = 0;
    this.open = false;
    this.suspended = false;
    this.detail = "";
    this.startedAt = Number(now());
    this.timer = null;
    this.toolTotal = 0;
    this.completed = 0;
  }

  /** True when this instance owns a live terminal row (vs. discrete lines). */
  get live() { return this.animate; }

  /** Claim the live row for one agent turn. */
  begin() {
    current = this;
    this.startedAt = Number(this.now());
    this.toolTotal = 0;
    this.completed = 0;
    return this;
  }

  setToolTotal(total) {
    this.toolTotal = Math.max(0, Number(total) || 0);
  }

  /** Model is waiting: first token, or between tool rounds. */
  waiting(text = "thinking") {
    this.paint(activityText([text, formatElapsed(this.startedAt, this.now())]));
  }

  /** `[scope] tool` — discrete only; the live row already names the tool. */
  label(tool) {
    if (this.animate) return;
    this.print(`${this.C?.c || ""}${this.C?.bold || ""}[${tool?.scope}]${this.C?.reset || ""} ${String(tool?.name || "tool")}`);
  }

  toolStart(tool) {
    const name = String(tool?.name || "tool");
    if (!this.animate) {
      this.print(`${this.C?.dim || ""}  ↳ ${name}…${this.C?.reset || ""}`);
      return;
    }
    this.paint(activityText([
      name,
      this.toolTotal ? `${this.completed + 1}/${this.toolTotal} tools` : null,
      formatElapsed(this.startedAt, this.now()),
    ]));
  }

  toolEnd(tool, ok) {
    const name = String(tool?.name || "tool");
    if (ok) this.completed += 1;
    if (!this.animate) {
      const tone = ok ? (this.C?.c || "") : (this.C?.err || "");
      this.print(`\r${tone}  ${ok ? "✓" : "✗"} ${name}${this.C?.reset || ""}`);
      return;
    }
    this.paint(activityText([
      `${ok ? "✓" : "✗"} ${name}`,
      this.toolTotal ? `${this.completed}/${this.toolTotal} ok` : null,
      formatElapsed(this.startedAt, this.now()),
    ]));
  }

  /** Turn finished: replace the live row with a compact receipt (or nothing). */
  finish(text = "") {
    const detail = String(text || "");
    this.stopTicker();
    if (this.animate) this.clear();
    if (detail) this.print(`${this.C?.dim || ""}${detail}${this.C?.reset || ""}`);
    if (current === this) current = null;
  }

  /** Drop the live row (used before streamed model text takes the terminal). */
  clear() {
    if (this.open) {
      this.output.write(`\r${CLEAR_ACTIVITY_LINE}`);
      this.open = false;
    }
  }

  stop() {
    this.stopTicker();
    this.clear();
    if (current === this) current = null;
  }

  suspend() {
    this.clear();
    this.suspended = true;
  }

  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.detail) this.paint(this.detail);
  }

  paint(text) {
    const line = String(text ?? "");
    this.detail = line;
    if (!this.animate || this.suspended || !line) return;
    this.open = true;
    this.render();
    this.ensureTicker();
  }

  render() {
    this.output.write(`\r${CLEAR_ACTIVITY_LINE}${this.C?.dim || ""}  ${this.frameMark()} ${this.detail}${this.C?.reset || ""}`);
  }

  frameMark() {
    return FRAMES[this.frame % FRAMES.length];
  }

  ensureTicker() {
    if (this.timer || !this.animate) return;
    this.timer = this.setIntervalImpl(() => {
      if (!this.open || this.suspended || !this.detail) return;
      this.frame = (this.frame + 1) % FRAMES.length;
      this.render();
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  stopTicker() {
    if (this.timer) {
      this.clearIntervalImpl(this.timer);
      this.timer = null;
    }
  }
}

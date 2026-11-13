// Input contracts for the bot desktop observer. Pure functions, no host access, so
// the rules that keep a client string out of an argv are readable in one place and
// testable without Docker. lib/desktop/observer.ts is the only caller.
import "server-only";
import { HostError } from "@/lib/host/host-error";

/** The label grokbot writes on every box it creates; the whole inventory contract. */
export const DESKTOP_LABEL = "grokbot.desktop=1";

/** A docker id or name: no whitespace, no leading dash, so it cannot become a flag. */
const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{11,63}$/;

/**
 * Two digits, optionally prefixed with ':'. This is the documented hard
 * requirement: `^:?[0-9]{2}$`. It permits `:99` (the primary display) and the
 * two-digit extra displays, and rejects every single-digit display.
 */
const SCREEN_RE = /^:?[0-9]{2}$/;

export type DesktopLifecycleAction = "start" | "stop" | "restart" | "logs";

/** The mutation allowlist. Adding a verb here is the only way to gain a new one. */
export const DESKTOP_LIFECYCLE_ACTIONS: readonly DesktopLifecycleAction[] = [
  "start",
  "stop",
  "restart",
  "logs",
];

export const LOG_LINES_DEFAULT = 80;
export const LOG_LINES_MAX = 500;

/**
 * Container selector.
 *
 * Everything through here is 12-64 characters of `[A-Za-z0-9_.-]` with an
 * alphanumeric first character. That cannot express a flag (`-v` fails the
 * first-character rule and the length), a path (`/`), a shell word (`;`, `|`, `$`,
 * backtick, whitespace), or a second argument. A rejection is a 400 with a message
 * the caller can act on; it never reaches `docker`.
 */
export function parseContainerId(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) throw new HostError("container is required", 400);
  if (!CONTAINER_RE.test(value)) {
    throw new HostError(
      "Invalid container: expected 12-64 characters of [A-Za-z0-9_.-]",
      400,
    );
  }
  return value;
}

/**
 * Display selector -> the single argv form used from here on.
 *
 * The accepted shape is exactly `^:?[0-9]{2}$`. The `:` prefix is added when it
 * is absent; the digits themselves are preserved rather than re-formatted, which
 * keeps the server in control of the string while staying faithful to X's own
 * parsing (Xlib reads the display number with `strtol`, so `:01` and `:1` are the
 * same display, and re-formatting would silently retarget a zero-padded screen).
 */
export function parseScreen(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) throw new HostError("screen is required", 400);
  if (!SCREEN_RE.test(value)) {
    throw new HostError(
      "Invalid screen: expected two digits, optionally prefixed with ':'",
      400,
    );
  }
  const display = value.startsWith(":") ? value : `:${value}`;
  const number = Number.parseInt(display.slice(1), 10);
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new HostError("Invalid screen: display must be between 1 and 99", 400);
  }
  return display;
}

export function parseLifecycleAction(raw: string | null | undefined): DesktopLifecycleAction {
  const value = (raw ?? "").trim();
  const action = DESKTOP_LIFECYCLE_ACTIONS.find((candidate) => candidate === value);
  if (!action) {
    throw new HostError(
      `Invalid action: expected one of ${DESKTOP_LIFECYCLE_ACTIONS.join(", ")}`,
      400,
    );
  }
  return action;
}

/** Bound a log request to something a terminal can actually read. */
export function parseLogLines(raw: number | null | undefined): number {
  if (raw == null) return LOG_LINES_DEFAULT;
  if (!Number.isInteger(raw) || raw < 1) {
    throw new HostError(
      `Invalid lines: expected an integer between 1 and ${LOG_LINES_MAX}`,
      400,
    );
  }
  return Math.min(raw, LOG_LINES_MAX);
}

import { spawnSync } from "node:child_process";
import process from "node:process";
import { withPanelSuspended } from "./mso-agent-turn-print.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

/**
 * Suspends the alternate-screen panel and yields the terminal to a child shell process.
 * When called with no arguments, spawns an interactive user shell ($SHELL or /bin/sh).
 * When called with command arguments, runs the command once via -c and reports non-zero exit status.
 *
 * @param {object} ctx - Execution context containing session and optional printer.
 * @param {string[]} [args] - Arguments passed after /terminal.
 * @param {object} [options] - Optional overrides for spawn, env, and shell (used in tests).
 * @returns {Promise<string>} Slash command outcome ("handled").
 */
export async function handleTerminalCommand(ctx, args = [], options = {}) {
  const session = ctx?.session;
  const loop = ctx?.screenLoop || session?.screenLoop;
  const printer = ctx?.printer || createPrinter(ctx);

  const env = options.env || ctx?.env || session?.env || process.env;
  const shell = options.shell || ctx?.shell || session?.shell || env.SHELL || "/bin/sh";
  const spawn = options.spawn || ctx?.spawn || session?.spawn || spawnSync;

  const cmdArgs = Array.isArray(args) ? args : [args].filter(Boolean);
  const hasCommand = cmdArgs.length > 0;
  // Interactive shells require an empty argv array, while commands run through shell -c.
  const argv = hasCommand ? ["-c", cmdArgs.join(" ")] : [];

  let result = null;
  let spawnError = null;

  // withPanelSuspended ensures the alternate screen is exited and mouse reporting disabled
  // before the child process takes over stdio, and guarantees resume even if spawn throws.
  await withPanelSuspended(loop, () => {
    try {
      result = spawn(shell, argv, { stdio: "inherit", env });
    } catch (err) {
      spawnError = err;
    }
  });

  // Spawn failures (such as missing shell executable) are reported to the transcript.
  if (spawnError) {
    const message = spawnError instanceof Error ? spawnError.message : String(spawnError);
    printer.print(`terminal: ${message}`);
    return "handled";
  }

  if (result?.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    printer.print(`terminal: ${message}`);
    return "handled";
  }

  // Non-zero exit status is reported to the transcript so failures are not swallowed.
  const status = result?.status ?? (result?.signal ? 1 : 0);
  if (status !== 0) {
    printer.print(`terminal: exit ${status}`);
  }

  return "handled";
}

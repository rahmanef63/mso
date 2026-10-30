import process from "node:process";

export const ENTER_SEQUENCE = "\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H";
export const LEAVE_SEQUENCE = "\x1b[0m\x1b[?25h\x1b[?1049l";

// Tracks active streams currently displaying alternate screen buffer.
const activeOutputs = new Set();

export function isScreenActive(output = process.stdout) {
  return activeOutputs.has(output);
}

// Determines if alternate screen mode was explicitly requested and conditions permit it.
// Guarded to prevent accidental activation in CI, non-TTY environments, or one-shot mode.
/** @param {{ argv?: string[], env?: Record<string, string | undefined>, isTTY?: boolean }} [options] */
export function altScreenRequested({
  argv = process.argv.slice(2),
  env = process.env,
  isTTY = process.stdout?.isTTY,
} = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const environment = env || {};

  const requested = Boolean(
    args.includes("--altscreen") ||
    args.includes("--alt-screen") ||
    environment.MSO_ALT_SCREEN === "1" ||
    environment.MSO_ALTSCREEN === "1"
  );

  if (!requested) {
    return { ok: false, enabled: false, requested: false, reason: "not_requested" };
  }

  if (isTTY !== true) {
    return { ok: false, enabled: false, requested: true, reason: "not_tty" };
  }

  const ci = environment.CI;
  if (Boolean(ci && ci !== "0" && ci !== "false")) {
    return { ok: false, enabled: false, requested: true, reason: "ci_environment" };
  }

  if (args.includes("--oneshot") || args.includes("-z")) {
    return { ok: false, enabled: false, requested: true, reason: "oneshot_mode" };
  }

  return { ok: true, enabled: true, requested: true, reason: null };
}

// Enters alternate screen mode idempotently.
// Writes enter sequence only on the first call for a given output stream.
/** @param {any} [output] */
export function enterScreen(output = process.stdout) {
  if (!output || typeof output.write !== "function") return false;
  if (activeOutputs.has(output)) return false;
  try {
    output.write(ENTER_SEQUENCE);
    activeOutputs.add(output);
    return true;
  } catch {
    return false;
  }
}

// Releases alternate screen mode idempotently.
// Deletes from tracking set before writing so teardown does not repeat on write errors.
/** @param {any} [output] */
export function leaveScreen(output) {
  if (output) {
    if (!activeOutputs.has(output)) return false;
    activeOutputs.delete(output);
    if (typeof output.write !== "function") return false;
    try {
      output.write(LEAVE_SEQUENCE);
      return true;
    } catch {
      return false;
    }
  }

  if (activeOutputs.size === 0) return false;
  let released = false;
  for (const stream of [...activeOutputs]) {
    activeOutputs.delete(stream);
    if (typeof stream?.write === "function") {
      try {
        stream.write(LEAVE_SEQUENCE);
        released = true;
      } catch {
        // Suppress write errors during exit to allow remaining teardown to continue.
      }
    }
  }
  return released;
}

// One call for the entrypoint: register teardown first, then enter, so a signal that arrives
// during the write is already covered. Dispose releases the screen before removing handlers,
// because removing first would leave a handled exit with the alternate buffer still active.
/** @param {{ requested?: any, output?: any, processRef?: any }} [options] */
export function startAltScreen({ requested, output = process.stdout, processRef } = {}) {
  if (!requested?.ok) return { entered: false, dispose() {} };
  const teardown = installTeardown({ output, processRef });
  const entered = enterScreen(output);
  return {
    entered,
    dispose() {
      leaveScreen(output);
      teardown.dispose();
    },
  };
}

// Installs exit, SIGINT, SIGTERM, and SIGHUP listeners that release alternate screen.
// Returns a dispose function to restore exact original listener count without replacing pre-existing handlers.
/** @param {{ output?: any, processRef?: any, signalSource?: any }} [options] */
export function installTeardown({
  output = process.stdout,
  processRef,
  signalSource,
} = {}) {
  const proc = processRef || signalSource || process;
  const sigs = signalSource || processRef || process;

  const onTeardown = () => {
    leaveScreen(output);
  };

  const cleanups = [];

  const attach = (target, event, listener) => {
    if (!target || typeof target.on !== "function") return;
    target.on(event, listener);
    cleanups.push(() => {
      if (typeof target.off === "function") {
        target.off(event, listener);
      } else if (typeof target.removeListener === "function") {
        target.removeListener(event, listener);
      }
    });
  };

  attach(proc, "exit", onTeardown);
  attach(sigs, "SIGINT", onTeardown);
  attach(sigs, "SIGTERM", onTeardown);
  attach(sigs, "SIGHUP", onTeardown);

  return {
    dispose() {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
    },
  };
}

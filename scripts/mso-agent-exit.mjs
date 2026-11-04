// The exit path for the interactive TUI.
//
// Split out of the entrypoint because it is the one place where ORDER is the whole point, and it is easy to
// reintroduce: the farewell line has to be written AFTER the alternate screen is left, or it lands in the
// buffer that is about to be discarded and the user never sees it.

/**
 * Writes JSON on stdout for a `--json` caller, then reports the failure on stderr and exits non-zero.
 *
 * A caller that asked for JSON asked for a machine-readable contract. Printing only a sentence to stderr
 * broke that contract on exactly the paths where it matters most: failures.
 *
 * @param {unknown} error
 * @param {{colors?: any, argv?: string[], exit?: (code: number) => void, stdout?: any, stderr?: any}} [deps]
 */
export function failRun(error, deps = {}) {
  const {
    colors = {}, argv = process.argv, exit = (code) => process.exit(code),
    stdout = process.stdout, stderr = process.stderr,
  } = deps;
  const message = error instanceof Error ? error.message : String(error);
  if (argv.includes("--json")) stdout.write(`${JSON.stringify({ ok: false, error: message, kind: "runtime" })}\n`);
  stderr.write(`${colors.err || ""}mso agent: ${message}${colors.reset || ""}\n`);
  exit(1);
}

/**
 * Runs the teardown sequence in the order the terminal needs it.
 *
 * Screen disposal comes BEFORE anything that prints: leaving the alternate screen discards it, so a line
 * written earlier is erased along with the frame.
 *
 * @param {{session?: any, restartRequested?: boolean, resumeHint?: boolean, localBridge?: any,
 *   closeComposer?: () => void, disposePanel?: () => void, disposeScreen?: () => void,
 *   print?: (line: string) => void, colors?: any}} input
 */
export async function finishRun({
  session, restartRequested = false, resumeHint = true, localBridge = null,
  closeComposer = () => {}, disposePanel = () => {}, disposeScreen = () => {},
  print = (line) => console.log(line), colors = {},
}) {
  const title = String(session?.agentSession?.title || "MSO Agent session")
    .replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
  const dim = colors.dim || "", reset = colors.reset || "";

  if (localBridge) await localBridge.close({ ended: !restartRequested }).catch(() => undefined);
  closeComposer();
  disposePanel();
  disposeScreen();

  // Both of these belong to the normal screen, so they run after the panel has handed it back.
  if (!restartRequested && session && resumeHint) {
    print(`${dim}session ${title} · resume: mso --continue · switch: /sessions${reset}`);
  }
  if (!restartRequested) return null;
  print(`${dim}↻ refreshing Agent runtime · keeping ${title || "current session"}${reset}`);
  return "restart";
}

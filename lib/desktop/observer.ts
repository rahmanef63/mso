import "server-only";
import { HostError } from "@/lib/host/host-error";
import { parseLogLines, parseScreen, type DesktopLifecycleAction } from "@/lib/desktop/contracts";
import {
  deps,
  docker,
  failure,
  listDesktopContainers,
  requireObservedContainer,
  type DesktopContainer,
  type ObserverDeps,
} from "@/lib/desktop/inventory";

// Read-mostly actions on bot desktop containers that another app (grokbot) creates.
// MSO is NOT an execution surface for bot commands: no caller-supplied command
// string, no shell, no exec passthrough. The only client values that reach an argv are
// a validated container id and a normalised display number, in fixed positions.
//
// Inventory and docker plumbing live in lib/desktop/inventory.ts, input rules in
// lib/desktop/contracts.ts.

export type { DesktopContainer, ObserverDeps } from "@/lib/desktop/inventory";
export { listDesktopContainers } from "@/lib/desktop/inventory";

/** Screenshot tool installed inside the bot desktop image. */
const SHOT_PROGRAM = "grokbot-shot";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG magic number. A tool that prints an error to stdout must not become an image. */
export function isPng(bytes: Buffer): boolean {
  return bytes.length > PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

/**
 * PNG bytes of one X display inside one bot container.
 *
 * This is the only `docker exec` in the module and its argv is fully
 * server-constructed: the display already went through `parseScreen`, and the
 * container is a name read back from our own inventory. Nothing is quoted or escaped
 * because nothing here is a shell string: `runProgramBytes` spawns with
 * `shell: false` and an argv array.
 */
export async function screenshotDesktop(
  container: string,
  screen: string,
  overrides: ObserverDeps = {},
): Promise<Buffer> {
  const resolved = deps(overrides);
  // Both selectors are validated before anything is spawned: a rejected request must
  // cost zero host work.
  const display = parseScreen(screen);
  const name = (await requireObservedContainer(resolved, container)).name;
  const result = await resolved.runBytes("docker", ["exec", name, SHOT_PROGRAM, display], 30_000);
  if (result.code !== 0) throw failure("exec", { ...result, stdout: result.stderr });
  if (!isPng(result.stdout)) {
    throw new HostError("Screenshot producer did not return a PNG", 502);
  }
  return result.stdout;
}

export interface DesktopLifecycleResult {
  action: DesktopLifecycleAction;
  container: string;
  /** Lifecycle verbs re-read the inventory so the caller sees the new state. */
  state: DesktopContainer | null;
  /** Present only for `logs`: the last N lines, oldest first, bounded. */
  logs?: string[];
}

/**
 * The whole mutation surface: four verbs, no argument beyond a validated container id
 * and a bounded tail length. There is no way to ask this function to run a command,
 * and gaining one would mean adding a new verb to the allowlist first.
 */
export async function desktopLifecycle(
  container: string,
  action: DesktopLifecycleAction,
  opts: { lines?: number; deps?: ObserverDeps } = {},
): Promise<DesktopLifecycleResult> {
  const resolved = deps(opts.deps ?? {});
  const name = (await requireObservedContainer(resolved, container)).name;

  if (action === "logs") {
    const lines = parseLogLines(opts.lines);
    const result = await docker(resolved, ["logs", "--tail", String(lines), name], 20_000);
    // `docker logs` writes the app's stderr to our stderr; a nonzero code means the
    // container is gone, not that the log is empty.
    if (result.code !== 0) throw failure("logs", result);
    const observed = await listDesktopContainers(resolved).catch(() => null);
    return {
      action,
      container: name,
      state: observed?.find((row) => row.name === name) ?? null,
      logs: [...result.stdout.split("\n"), ...result.stderr.split("\n")]
        .filter((line) => line !== "")
        .slice(-lines),
    };
  }

  const result = await docker(resolved, [action, name], 60_000);
  // `docker start` on an already-running box is rc 0; a real failure is not.
  if (result.code !== 0) throw failure(action, result);
  const after = await listDesktopContainers(resolved).catch(() => null);
  return {
    action,
    container: name,
    state: after?.find((row) => row.name === name) ?? null,
  };
}

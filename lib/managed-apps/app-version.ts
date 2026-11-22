// The `--version` string shown in a managed app's Details pane.
//
// Extracted from manager.ts because this probe is the one host call in that file
// that costs seconds and buys a string nobody is waiting for. Measured on this
// host: `hermes --version` is 15.4 s wall on a cold Python environment, 0.06 s for
// `openclaw --version`. The value only moves on upgrade.
//
// Why waiting was a bug, measured:
//   • ManagedAppsSurface holds "Detecting…" until /api/v1/managed-apps answers, so
//     a blocking probe delays the window's first paint by the whole cap.
//   • Detection and the app-host proxy share one process. With three detect calls
//     in flight, average latency of 12 Orca assets went 1.13 s → 2.17 s. Serving
//     the same list from a frozen snapshot cut Orca's blank window from 13–19 s
//     to 9–10 s.
//
// So the read is synchronous: it returns the last measured value (null until one
// exists, which the pane already renders as "unknown"), and warms or refreshes the
// cache in the background. Concurrent callers share ONE in-flight probe per app so
// overlapping window polls cannot stack up child processes.
import { resolveCommand, runProgram } from "./runner";
import type { ManagedAppDefinition, ManagedAppId } from "./types";

const TTL_MS = 60_000;

// Long enough for a warm probe (all but Hermes finish well under a second), short
// enough that one which cannot finish stops holding a child process open.
const PROBE_MS = 4_000;

const cache = new Map<ManagedAppId, { value: string | null; at: number }>();
const inFlight = new Map<ManagedAppId, Promise<string | null>>();

/** Run one probe, reusing this app's in-flight one. Exported for callers and tests
 *  that genuinely need the settled value. */
export function probeAppVersion(definition: ManagedAppDefinition): Promise<string | null> {
  const running = inFlight.get(definition.id);
  if (running) return running;
  const run = (async () => {
    let value: string | null = null;
    // Resolved to a path, not spawned by bare name: under systemd the unit's PATH
    // does not contain ~/.local/bin, where both upstream CLIs install themselves.
    const program = await resolveCommand(definition.command);
    if (program) {
      const result = await runProgram(program, ["--version"], PROBE_MS);
      value = result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0]?.slice(0, 160) || null : null;
    }
    cache.set(definition.id, { value, at: Date.now() });
    return value;
  })().finally(() => inFlight.delete(definition.id));
  inFlight.set(definition.id, run);
  return run;
}

/** Last measured version, or null while one is still being measured. Never blocks;
 *  the probe it starts reports on a later poll. */
export function appVersion(definition: ManagedAppDefinition): string | null {
  const hit = cache.get(definition.id);
  if (!hit || Date.now() - hit.at >= TTL_MS) void probeAppVersion(definition);
  return hit?.value ?? null;
}

/** The settled version, for the one caller that can afford to wait: the single-app
 *  route behind `mso mapp show` and the Details pane. A list stays on appVersion(),
 *  so its first paint is never held; a reader of ONE app gets the real string
 *  instead of the null a cold cache would report as "unknown". */
export async function settledAppVersion(definition: ManagedAppDefinition): Promise<string | null> {
  const hit = cache.get(definition.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  return probeAppVersion(definition);
}

/** An install/restart is the only thing that can move the string. */
export function forgetAppVersion(id: ManagedAppId): void {
  cache.delete(id);
}

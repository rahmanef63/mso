import "server-only";
import {
  resolveCommand,
  runProgram,
  runProgramBytes,
  type ProgramBytesResult,
  type ProgramResult,
} from "@/lib/managed-apps/runner";
import { HostError } from "@/lib/host/host-error";
import { DESKTOP_LABEL, parseContainerId } from "@/lib/desktop/contracts";

// Docker plumbing and the container inventory for bot desktops (label
// `grokbot.desktop=1`). Split from lib/desktop/observer.ts so the inventory contract
// and the mutation contract can each be read on their own.

export interface DesktopContainer {
  /** Short docker id, 12 characters. */
  id: string;
  name: string;
  state: string;
  status: string;
  /** Only the two labels MSO has a documented use for; never the whole label map. */
  labels: { user: string | null; bot: string | null };
  created: string;
  ports: string;
}

/** Injected so no test needs a Docker daemon. */
export interface ObserverDeps {
  run?: (command: string, args: readonly string[], timeout?: number) => Promise<ProgramResult>;
  runBytes?: (command: string, args: readonly string[], timeout?: number) => Promise<ProgramBytesResult>;
  /** Whether a Docker client exists. Separate so a test can prove the fail-closed path. */
  hasDocker?: () => Promise<boolean>;
}

export type ResolvedDeps = Required<ObserverDeps>;

const defaultDeps = (): ResolvedDeps => ({
  run: runProgram,
  runBytes: runProgramBytes,
  // The same detector managed-apps uses, so an install whose `docker` lives off the
  // service unit's narrow PATH is still found.
  hasDocker: async () => (await resolveCommand("docker")) !== null,
});

export function deps(overrides: ObserverDeps): ResolvedDeps {
  const base = defaultDeps();
  return {
    run: overrides.run ?? base.run,
    runBytes: overrides.runBytes ?? base.runBytes,
    hasDocker: overrides.hasDocker ?? base.hasDocker,
  };
}

/**
 * One `docker ps` line -> the observer shape. Exported because the parsing rules are
 * what silently rots when Docker renames a field. JSON (`{{json .}}`) is what we ask
 * for; a delimited fallback keeps an older Docker degrading instead of throwing.
 */
export function parseContainerLine(line: string): DesktopContainer | null {
  const text = line.trim();
  if (!text) return null;
  let raw: Record<string, unknown>;
  if (text.startsWith("{")) {
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    const [id, name, state, status, ports] = text.split("\t");
    raw = { ID: id, Names: name, State: state, Status: status, Ports: ports };
  }
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value) return value;
    }
    return "";
  };
  const id = pick("ID", "Id", "id");
  if (!id) return null;
  // Only these two labels leave the host. `docker ps` can echo a whole label map, and
  // a label carrying a credential would turn a status read into a leak. Env vars are
  // never requested at all.
  const labels = (raw.Labels ?? {}) as Record<string, unknown>;
  const user = labels["grokbot.user"];
  const bot = labels["grokbot.bot"];
  return {
    id: id.slice(0, 12),
    name: pick("Names", "Name", "name").replace(/^\//, ""),
    state: pick("State", "state"),
    status: pick("Status", "status"),
    labels: {
      user: typeof user === "string" ? user : null,
      bot: typeof bot === "string" ? bot : null,
    },
    created: pick("CreatedAt", "Created", "created"),
    ports: pick("Ports", "ports"),
  };
}

export function failure(
  verb: string,
  result: { code: number; stdout: string; stderr: string },
): HostError {
  const reason = (result.stderr || result.stdout).trim().slice(0, 300);
  // The daemon's own message is the useful one ("No such container"), and it cannot
  // contain a caller-supplied command because there is no caller-supplied command.
  return new HostError(`docker ${verb} failed: ${reason || `exit ${result.code}`}`, 502);
}

export async function docker(
  resolved: ResolvedDeps,
  args: readonly string[],
  timeout: number,
): Promise<ProgramResult> {
  if (!(await resolved.hasDocker())) {
    throw new HostError("Docker is not available to the MSO service user", 503);
  }
  return resolved.run("docker", args, timeout);
}

/** Every bot desktop container this host knows about. Read-only. */
export async function listDesktopContainers(
  overrides: ObserverDeps = {},
): Promise<DesktopContainer[]> {
  const result = await docker(
    deps(overrides),
    ["ps", "-a", "--filter", `label=${DESKTOP_LABEL}`, "--format", "{{json .}}"],
    20_000,
  );
  if (result.code !== 0) throw failure("ps", result);
  return result.stdout
    .split("\n")
    .map(parseContainerLine)
    .filter((row): row is DesktopContainer => row !== null);
}

/**
 * Refuse a container that is not one of ours.
 *
 * The label filter protects the LIST. Alone it would not protect a screenshot or a
 * stop: a caller who learned any container id on the host could otherwise read
 * another app's screen or shut it down. Membership is checked against the same
 * inventory the list endpoint returns, so the two cannot disagree. Validation runs
 * first, so a rejected selector costs zero host work.
 */
export async function requireObservedContainer(
  resolved: ResolvedDeps,
  container: string,
): Promise<DesktopContainer> {
  const id = parseContainerId(container);
  const containers = await listDesktopContainers(resolved);
  const match = containers.find((row) => row.id === id.slice(0, 12) || row.name === id);
  if (!match) throw new HostError("No bot desktop container with that id", 404);
  return match;
}

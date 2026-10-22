import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AcpClient, AcpError, type AcpClientOptions, type AcpInitializeResult } from "./acp-client";

// Driver + instance registry. Following t3code: a DRIVER KIND is data (how to launch an
// integration), an INSTANCE is one configuration + account lifecycle and owns its own
// child. Work routes through an instance, never through a driver kind, so two accounts
// on the same CLI cannot share a process, session or mutable state.

export interface AcpDriver {
  id: string;
  displayName: string;
  /** Executable name resolved through PATH; never a shell string. */
  executable: string;
  /** Fixed argv. Nothing user-supplied is ever concatenated into it. */
  args: readonly string[];
  /** Auth method id to use ONLY when the agent answers `auth_required` (-32000). */
  authenticateMethodId?: string;
  /** Documented ACP entry point, printed by `mso` diagnostics and the not-installed error. */
  installHint: string;
}

// Both drivers were verified on this host: `opencode acp` and `hermes-acp` answer
// `initialize` with protocolVersion 1. Codex and Claude Code do not expose ACP, so a
// "codex" driver here would be a lie about the wire protocol.
export const ACP_DRIVERS: readonly AcpDriver[] = [
  { id: "opencode", displayName: "OpenCode", executable: "opencode", args: ["acp"], authenticateMethodId: "opencode-login",
    installHint: "opencode — install from https://opencode.ai" },
  { id: "hermes", displayName: "Hermes Agent", executable: "hermes-acp", args: [],
    installHint: "hermes-acp — install Hermes Agent with its ACP adapter" },
];

export function acpDriver(id: string): AcpDriver {
  const driver = ACP_DRIVERS.find(row => row.id === id);
  if (!driver) throw new AcpError("acp_driver_unknown", 422);
  return driver;
}

export interface AcpDriverInfo {
  id: string; displayName: string; installed: boolean; executablePath: string | null;
  args: readonly string[]; authenticateMethodId?: string; installHint: string;
}

/** PATH lookup without spawning: a missing binary is a clear "not installed", not ENOENT. */
function which(executable: string, envPath = process.env.PATH ?? ""): string | null {
  if (executable.includes("/")) {
    try { return statSync(executable).isFile() ? executable : null; } catch { return null; }
  }
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, executable);
    try { accessSync(candidate, constants.X_OK); if (statSync(candidate).isFile()) return candidate; } catch { /* next */ }
  }
  return null;
}

/**
 * Data-only availability: resolves the executable and reports it. Deliberately does
 * NOT spawn, so it cannot authenticate and cannot create a session — setup must never
 * be a health-check side effect (session/new may start MCP servers or a login browser).
 */
export function describeAcpDriver(id: string, options: { path?: string } = {}): AcpDriverInfo {
  const driver = acpDriver(id), executablePath = which(driver.executable, options.path);
  return { id: driver.id, displayName: driver.displayName, installed: executablePath !== null, executablePath,
    args: driver.args, ...(driver.authenticateMethodId ? { authenticateMethodId: driver.authenticateMethodId } : {}),
    installHint: driver.installHint };
}

export function requireAcpDriver(id: string, options: { path?: string } = {}): { driver: AcpDriver; executablePath: string } {
  const info = describeAcpDriver(id, options);
  if (!info.executablePath) throw new AcpError(`acp_driver_not_installed:${id}:${info.installHint}`, 501);
  return { driver: acpDriver(id), executablePath: info.executablePath };
}

/**
 * One live instance: opaque id, one driver kind, one child process, its own session.
 * There is no shared map inside the client, so interleaved requests on two instances
 * cannot cross-talk.
 */
export interface AcpInstance {
  readonly id: string;
  readonly driverId: string;
  readonly client: AcpClient;
  /** Handshake only. Never authenticates and never creates a session. */
  initialize(): Promise<AcpInitializeResult>;
  /** Opens a session; authenticates only if the agent answers `auth_required`. */
  openSession(input: { cwd: string }): Promise<string>;
  dispose(): void;
}

export interface CreateInstanceOptions extends Omit<AcpClientOptions, "command" | "args"> {
  /** Overrides PATH resolution (tests inject a fake agent here). */
  executablePath?: string;
  path?: string;
}

export function createAcpInstance(driverId: string, options: CreateInstanceOptions = {}): AcpInstance {
  const driver = acpDriver(driverId);
  const executablePath = options.executablePath ?? requireAcpDriver(driverId, { path: options.path }).executablePath;
  const client = new AcpClient({ ...options, command: executablePath, args: driver.args });
  return {
    id: `acp_${randomUUID()}`, driverId, client,
    initialize: () => client.initialize(),
    async openSession(input) {
      const create = () => client.newSession({ cwd: input.cwd });
      try { return await create(); }
      catch (error) {
        // -32000 is `auth_required`. Authenticate ONCE, only because the agent asked.
        if (!(error instanceof AcpError) || !error.message.includes(":-32000:") || !driver.authenticateMethodId) throw error;
        await client.authenticate(driver.authenticateMethodId);
        return create();
      }
    },
    dispose: () => client.dispose(),
  };
}

/** Initialize-only handshake: proves the protocol without creating a session. */
export async function probeAcpDriver(driverId: string, options: { path?: string; executablePath?: string } = {}): Promise<{
  driver: AcpDriverInfo; agent: AcpInitializeResult["agentInfo"]; protocolVersion: number; loadSession: boolean;
}> {
  const info = describeAcpDriver(driverId, { path: options.path });
  const executablePath = options.executablePath ?? info.executablePath;
  if (!executablePath) throw new AcpError(`acp_driver_not_installed:${driverId}:${info.installHint}`, 501);
  const client = new AcpClient({ command: executablePath, args: acpDriver(driverId).args });
  try {
    const result = await client.initialize();
    return { driver: info, agent: result.agentInfo, protocolVersion: result.protocolVersion,
      loadSession: result.agentCapabilities?.loadSession === true };
  } finally { client.dispose(); }
}

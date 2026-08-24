import "server-only";
import os from "node:os";
import { createBackup } from "./backups";
import { getManagedAppDefinition, listManagedAppDefinitions } from "./catalog";
import { acquireOperation, activeOperation, releaseOperation } from "./lock";
import { redact } from "./redact";
import { commandExists, requireProgram, resolveCommand, runProgram } from "./runner";
import { userBusEnv, userBusUnavailable } from "./user-bus";
import type { ManagedAppAction, ManagedAppDefinition, ManagedAppId, ManagedAppLogs, ManagedAppView } from "./types";

interface Installation {
  type: "systemd" | "docker" | "package" | "not-installed";
  serviceName?: string;
  containerName?: string;
}

// `is-active` cannot tell "this unit is stopped" from "this unit does not exist":
// on systemd 255 an unknown unit prints `inactive` with rc 4 and an empty stderr,
// so the old text match never fired and the FIRST configured name always won the
// detection. Real consequence: OpenClaw's catalog listed a non-existent
// `openclaw.service` first, so its card read "stopped" and start/stop/restart 409'd
// while its gateway was serving. `show -p LoadState` distinguishes them, and one
// call returns both facts.
async function systemdState(service: string): Promise<"active" | "inactive" | "missing"> {
  for (const scope of [["--user"], []]) {
    // The user scope needs a bus address. mso.service is a SYSTEM unit with
    // `User=`, which inherits no login session and therefore no
    // XDG_RUNTIME_DIR, so without this every `--user` probe below answered
    // "Failed to connect to bus: No medium found" and the whole scope was
    // silently skipped — the app then looked absent no matter what was running.
    const env = scope.length ? userBusEnv() : undefined;
    const result = await runProgram("systemctl", [...scope, "show", "-p", "LoadState", "-p", "ActiveState", service], 10_000, env);
    // Non-zero here is no systemctl at all, or no user bus — not an answer about
    // the unit, so try the next scope rather than concluding anything.
    if (result.code !== 0) continue;
    const load = /LoadState=(\S+)/.exec(result.stdout)?.[1];
    if (!load || load === "not-found") continue;
    return /ActiveState=active/.test(result.stdout) ? "active" : "inactive";
  }
  return "missing";
}

async function detect(definition: ManagedAppDefinition): Promise<Installation> {
  for (const serviceName of definition.serviceNames) {
    if (await systemdState(serviceName) !== "missing") return { type: "systemd", serviceName };
  }
  if (await commandExists("docker")) {
    const result = await runProgram("docker", ["ps", "-a", "--format", "{{.Names}}"], 10_000);
    const names = new Set(result.stdout.split(/\r?\n/).map((name) => name.trim()));
    const containerName = definition.containerNames.find((name) => names.has(name));
    if (containerName) return { type: "docker", containerName };
  }
  if (definition.commandProvesInstall !== false && await commandExists(definition.command)) return { type: "package" };
  return { type: "not-installed" };
}

async function running(installation: Installation): Promise<boolean> {
  if (installation.type === "systemd" && installation.serviceName) return (await systemdState(installation.serviceName)) === "active";
  if (installation.type === "docker" && installation.containerName) {
    const result = await runProgram("docker", ["inspect", "--format", "{{.State.Running}}", installation.containerName], 10_000);
    return result.code === 0 && result.stdout.trim() === "true";
  }
  return false;
}

async function health(definition: ManagedAppDefinition): Promise<boolean | null> {
  try {
    const response = await fetch(`${definition.dashboardUrl.replace(/\/$/, "")}${definition.healthPath ?? "/health"}`, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch {
    return null;
  }
}

/** Globally-routable IPv4 only. Private/CGNAT/link-local addresses are useful for
 *  MSO's internal proxy but are not the "works without a domain" address a user
 *  can open from their own browser. No external IP-discovery service is called. */
function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // RFC 6598 CGNAT
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

export function hostPublicIpv4(): string | null {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && isPublicIpv4(address.address)) return address.address;
    }
  }
  return null;
}

function directDashboardUrl(definition: ManagedAppDefinition): string | null {
  const configured = definition.publicUrl?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        return configured.replace(/\/$/, "");
      }
    } catch {
      // Bad operator config is not an app-health failure; fall through to the IP path.
    }
  }
  if (!definition.publicPort) return null;
  const address = hostPublicIpv4();
  return address ? `http://${address}:${definition.publicPort}` : null;
}

// `--version` forks the app's own binary, which is not free (hermes: ~0.44 s of CPU
// per call on this host) — and the Managed Apps panel re-polls every 10 s, for a
// string that only changes on upgrade. Cached per app id; performManagedAppAction
// drops the entry, since an install/restart is the only thing that can move it.
const VERSION_TTL_MS = 60_000;
const versionCache = new Map<ManagedAppId, { value: string | null; at: number }>();

async function version(definition: ManagedAppDefinition): Promise<string | null> {
  const hit = versionCache.get(definition.id);
  if (hit && Date.now() - hit.at < VERSION_TTL_MS) return hit.value;
  let value: string | null = null;
  // Resolved to a path, not spawned by bare name: under systemd the unit's PATH
  // does not contain ~/.local/bin, where both upstream CLIs install themselves.
  const program = await resolveCommand(definition.command);
  if (program) {
    const result = await runProgram(program, ["--version"], 10_000);
    value = result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0]?.slice(0, 160) || null : null;
  }
  versionCache.set(definition.id, { value, at: Date.now() });
  return value;
}

function actionsFor(installation: Installation): ManagedAppAction[] {
  if (installation.type === "systemd" || installation.type === "docker") return ["start", "stop", "restart", "backup"];
  if (installation.type === "package") return ["backup"];
  return [];
}

export async function getManagedApp(id: ManagedAppId): Promise<ManagedAppView> {
  const definition = getManagedAppDefinition(id);
  const installation = await detect(definition);
  const isRunning = await running(installation);
  const isHealthy = isRunning ? await health(definition) : null;
  const operation = activeOperation(id);
  const state = operation === "start"
    ? "starting"
    : installation.type === "not-installed"
      ? "not-installed"
      : isHealthy === false
        ? "unhealthy"
        : isRunning
          ? "running"
          : "stopped";
  return {
    id,
    name: definition.name,
    description: definition.description,
    installed: installation.type !== "not-installed",
    installationType: installation.type,
    state,
    healthy: isHealthy,
    version: await version(definition),
    dashboardAvailable: isRunning && isHealthy !== false,
    publicDashboardUrl: directDashboardUrl(definition),
    supportedActions: actionsFor(installation),
    // Only ever attached to a NEGATIVE reading. An app detected as present has
    // been seen, and nothing about the bus can make that observation wrong.
    diagnostic:
      installation.type === "not-installed" && userBusUnavailable()
        ? "MSO cannot reach this user's systemd bus, so it cannot see user services — this app may in fact be installed. Run `loginctl enable-linger` for the user, and set XDG_RUNTIME_DIR=/run/user/<uid> in mso.service (a drop-in under /etc/systemd/system/mso.service.d/)."
        : null,
  };
}

export async function listManagedApps(): Promise<ManagedAppView[]> {
  const views: ManagedAppView[] = [];
  for (const definition of listManagedAppDefinitions()) views.push(await getManagedApp(definition.id));
  return views;
}

async function runLifecycle(installation: Installation, action: "start" | "stop" | "restart"): Promise<void> {
  if (installation.type === "systemd" && installation.serviceName) {
    let lastError = "";
    for (const args of [["--user", action, installation.serviceName], [action, installation.serviceName]]) {
      const result = await runProgram("systemctl", args, 30_000, args[0] === "--user" ? userBusEnv() : undefined);
      if (result.code === 0) return;
      lastError = result.stderr.trim() || result.stdout.trim() || `systemctl exited ${result.code}`;
    }
    // Falling through to the generic throw below reported every one of these as
    // "operation unsupported for detected installation type" — served as a 409,
    // and flatly untrue: the installation type was detected fine, systemctl just
    // refused. An unreachable user bus surfaced as a category error about the app.
    throw new Error(`systemctl ${action} ${installation.serviceName} failed: ${lastError.slice(0, 300)}`);
  }
  if (installation.type === "docker" && installation.containerName) {
    await requireProgram("docker", [action, installation.containerName], 30_000);
    return;
  }
  throw new Error("operation unsupported for detected installation type");
}

export async function performManagedAppAction(id: ManagedAppId, action: ManagedAppAction): Promise<ManagedAppView> {
  // Taken before detection now, and shared with the job layer (lock.ts), so a
  // 30-minute update and a `restart` can never interleave on the same app.
  if (!acquireOperation(id, action)) throw new Error("another operation is already running");
  try {
    const definition = getManagedAppDefinition(id);
    const installation = await detect(definition);
    if (!actionsFor(installation).includes(action)) throw new Error("operation unsupported for detected installation type");
    if (action === "backup") await createBackup(definition, "manual");
    else await runLifecycle(installation, action);
  } finally {
    releaseOperation(id);
    // The action may have installed/upgraded the binary — drop the cached version
    // so the view returned below reports the new one, not a stale ≤60 s reading.
    versionCache.delete(id);
  }
  return getManagedApp(id);
}

export async function getManagedAppLogs(id: ManagedAppId): Promise<ManagedAppLogs> {
  const definition = getManagedAppDefinition(id);
  const installation = await detect(definition);
  let result = null;
  if (installation.type === "systemd" && installation.serviceName) {
    result = await runProgram("journalctl", ["--user", "-u", installation.serviceName, "-n", "100", "--no-pager", "-o", "short-iso"], 15_000);
    if (result.code !== 0) result = await runProgram("journalctl", ["-u", installation.serviceName, "-n", "100", "--no-pager", "-o", "short-iso"], 15_000);
  } else if (installation.type === "docker" && installation.containerName) {
    result = await runProgram("docker", ["logs", "--tail", "100", installation.containerName], 15_000);
  }
  if (!result || result.code !== 0) return { available: false, entries: [] };
  return { available: true, entries: `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter(Boolean).slice(-100).map(redact) };
}

import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ServiceAction,
  ServiceInventory,
  ServiceLogs,
  ServiceScope,
  SystemService,
} from "@/lib/os-api/types";
import { userBusEnv } from "@/lib/managed-apps/user-bus";
import { childEnv } from "./child-env";
import { HostError } from "./host-error";

const execFileAsync = promisify(execFile);
const MAX_SERVICES = 300;
const MAX_LOG_LINES = 200;
const UNIT_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,179}\.service$/;
const ACTIONS = new Set<ServiceAction>(["start", "stop", "restart"]);

const systemctlBin = () => process.env.MSO_SYSTEMCTL_BIN || "/usr/bin/systemctl";
const journalctlBin = () => process.env.MSO_JOURNALCTL_BIN || "/usr/bin/journalctl";

function assertScope(scope: unknown): asserts scope is ServiceScope {
  if (scope !== "system" && scope !== "user") throw new HostError("scope must be system or user");
}

function assertUnit(unit: unknown): asserts unit is string {
  if (typeof unit !== "string" || !UNIT_RE.test(unit)) throw new HostError("invalid systemd service unit");
}

function commandEnv(scope: ServiceScope): NodeJS.ProcessEnv {
  return { ...childEnv(), ...(scope === "user" ? userBusEnv() : undefined) } as NodeJS.ProcessEnv;
}

async function run(
  program: string,
  args: string[],
  scope: ServiceScope,
  timeout = 10_000,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(program, args, {
      env: commandEnv(scope),
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const detail = (e.stderr || e.stdout || e.message || "command failed").trim().slice(0, 320);
    throw new HostError(detail);
  }
}

export function validServiceUnit(unit: string): boolean {
  return UNIT_RE.test(unit);
}

export function serviceControlAllowlist(raw = process.env.OS_SERVICE_CONTROL_UNITS ?? ""): {
  units: Set<string>;
  diagnostics: string[];
} {
  const units = new Set<string>();
  const diagnostics: string[] = [];
  for (const item of raw.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean).slice(0, 64)) {
    const colon = item.indexOf(":");
    const scope = item.slice(0, colon);
    const unit = item.slice(colon + 1);
    if ((scope !== "system" && scope !== "user") || !validServiceUnit(unit)) {
      diagnostics.push(`Ignored invalid service allowlist entry: ${item.slice(0, 120)}`);
      continue;
    }
    units.add(`${scope}:${unit}`);
  }
  return { units, diagnostics };
}

export function parseSystemctlServices(
  stdout: string,
  scope: ServiceScope,
  controllable: ReadonlySet<string>,
): SystemService[] {
  const rows: SystemService[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim().replace(/^●\s*/, "");
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4 || !validServiceUnit(parts[0] ?? "")) continue;
    const [unit, load, active, sub, ...description] = parts;
    rows.push({
      unit,
      scope,
      load,
      active,
      sub,
      description: description.join(" "),
      controllable: controllable.has(`${scope}:${unit}`),
    });
  }
  return rows;
}

async function listScope(scope: ServiceScope, allowlist: ReadonlySet<string>): Promise<SystemService[]> {
  const args = [
    ...(scope === "user" ? ["--user"] : ["--system"]),
    "list-units",
    "--type=service",
    "--all",
    "--no-legend",
    "--no-pager",
    "--plain",
  ];
  const { stdout } = await run(systemctlBin(), args, scope);
  return parseSystemctlServices(stdout, scope, allowlist);
}

export async function listSystemServices(): Promise<ServiceInventory> {
  const allow = serviceControlAllowlist();
  const diagnostics = [...allow.diagnostics];
  const services: SystemService[] = [];
  for (const scope of ["user", "system"] as const) {
    try {
      services.push(...await listScope(scope, allow.units));
    } catch (error) {
      diagnostics.push(`${scope} services unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  services.sort((a, b) => a.scope.localeCompare(b.scope) || a.unit.localeCompare(b.unit));
  const truncated = services.length > MAX_SERVICES;
  return {
    services: services.slice(0, MAX_SERVICES),
    diagnostics,
    truncated,
    controlAllowlistConfigured: allow.units.size > 0,
    generatedAt: new Date().toISOString(),
  };
}

async function readService(scope: ServiceScope, unit: string, controllable: boolean): Promise<SystemService> {
  const args = [
    ...(scope === "user" ? ["--user"] : ["--system"]),
    "show",
    unit,
    "--no-pager",
    "--property=LoadState,ActiveState,SubState,Description",
  ];
  const { stdout } = await run(systemctlBin(), args, scope);
  const values = Object.fromEntries(stdout.split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)).filter((row) => row.length === 2));
  return {
    unit,
    scope,
    load: values.LoadState || "unknown",
    active: values.ActiveState || "unknown",
    sub: values.SubState || "unknown",
    description: values.Description || "",
    controllable,
  };
}

export async function servicePower(scope: ServiceScope, unit: string, action: ServiceAction): Promise<SystemService> {
  assertScope(scope);
  assertUnit(unit);
  if (!ACTIONS.has(action)) throw new HostError("action must be start, stop, or restart");
  const allow = serviceControlAllowlist();
  const key = `${scope}:${unit}`;
  if (!allow.units.has(key)) throw new HostError("service action is not allowlisted by OS_SERVICE_CONTROL_UNITS");

  if (scope === "system" && process.env.OS_SERVICE_CONTROL_USE_SUDO === "1") {
    const sudo = process.env.MSO_SUDO_BIN || "/usr/bin/sudo";
    await run(sudo, ["-n", systemctlBin(), "--system", action, unit], scope, 30_000);
  } else {
    const args = [...(scope === "user" ? ["--user"] : ["--system"]), action, unit];
    await run(systemctlBin(), args, scope, 30_000);
  }
  return readService(scope, unit, true);
}

export async function serviceLogs(scope: ServiceScope, unit: string, limit = 120): Promise<ServiceLogs> {
  assertScope(scope);
  assertUnit(unit);
  const lines = Math.min(Math.max(Math.floor(limit) || 120, 1), MAX_LOG_LINES);
  const args = ["--no-pager", "--output=short-iso", `--lines=${lines}`, scope === "user" ? `--user-unit=${unit}` : `--unit=${unit}`];
  try {
    const { stdout } = await run(journalctlBin(), args, scope, 15_000);
    return { unit, scope, entries: stdout.split("\n").filter(Boolean).slice(-lines), available: true };
  } catch (error) {
    return {
      unit,
      scope,
      entries: [],
      available: false,
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

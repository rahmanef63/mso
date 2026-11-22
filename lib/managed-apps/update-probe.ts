import "server-only";
import { redact } from "./redact";
import { runProgram, type ProgramResult } from "./runner";
import { MANAGED_APP_UPDATE_CHANNELS } from "./update-types";
import type { ManagedAppChannel } from "./update-types";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const clean = (text: string): string => text.replace(ANSI, "");

export interface ProbeResult {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  detail: string | null;
  channel: ManagedAppChannel;
  installKind: string | null;
  error: string | null;
}

export const HERMES_BRANCH_NOTE =
  "Hermes has no update channel. AppDeck updates Hermes from the reviewed pinned artifact lock in security/managed-app-artifacts.env.";

export function parseHermesCheck(result: ProgramResult): Pick<ProbeResult, "updateAvailable" | "detail" | "channel" | "error"> {
  const text = clean(`${result.stdout}\n${result.stderr}`);
  const ref = /behind ([A-Za-z0-9._/-]+)/.exec(text)?.[1]?.replace(/\.+$/, "") ?? null;
  const channel: ManagedAppChannel = {
    value: ref ? (ref.split("/").pop() ?? null) : null,
    kind: "branch",
    available: [],
    switchable: false,
    reason: HERMES_BRANCH_NOTE,
  };
  const failure = /^\s*✗ .*$/m.exec(text)?.[0]?.trim();
  if (failure || result.code !== 0) {
    return { updateAvailable: null, detail: null, channel, error: redact(failure ?? "hermes update --check failed") };
  }
  if (/Already up to date/.test(text)) return { updateAvailable: false, detail: "Already up to date.", channel, error: null };
  const available = /^.*Update available.*$/m.exec(text)?.[0]?.trim();
  if (available) return { updateAvailable: true, detail: redact(available), channel, error: null };
  return { updateAvailable: null, detail: null, channel, error: "could not read hermes update --check output" };
}

export async function probeHermes(program: string): Promise<ProbeResult> {
  const version = await runProgram(program, ["version"], 20_000);
  const versionText = clean(version.stdout);
  const check = parseHermesCheck(await runProgram(program, ["update", "--check"], 120_000));
  return {
    currentVersion: version.code === 0 ? versionText.split(/\r?\n/)[0]?.trim().slice(0, 160) || null : null,
    latestVersion: null,
    installKind: /^Install method:\s*(\S+)/m.exec(versionText)?.[1] ?? null,
    ...check,
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  for (const candidate of [trimmed, trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

async function probeJsonAdapter(
  program: string,
  appLabel: string,
  installKind: "docker" | "systemd",
  reason: string,
  timeoutMs = 60_000,
): Promise<ProbeResult> {
  const channel: ManagedAppChannel = { value: null, kind: null, available: [], switchable: false, reason };
  const check = await runProgram(program, ["check", "--json"], timeoutMs);
  const parsed = parseJson(clean(check.stdout));
  if (check.code !== 0 || !parsed) {
    const why = clean(check.stderr).split(/\r?\n/).find(Boolean) ?? `${appLabel} check --json returned no JSON`;
    return { currentVersion: null, latestVersion: null, updateAvailable: null, detail: null, channel, installKind, error: redact(why) };
  }
  return {
    currentVersion: asString(parsed.currentVersion),
    latestVersion: asString(parsed.latestVersion),
    updateAvailable: typeof parsed.hasUpdate === "boolean" ? parsed.hasUpdate : null,
    detail: asString(parsed.detail),
    channel,
    installKind,
    error: null,
  };
}

export const NINE_ROUTER_CHANNEL_NOTE =
  "9Router is pinned to the reviewed digest in security/managed-app-artifacts.env; update reconciles the container to that digest while keeping ~/.9router data intact.";
export const T3_CHANNEL_NOTE =
  "T3 Code is pinned to the reviewed release tarball and SHA-256 in security/managed-app-artifacts.env; update reconciles the binary while keeping ~/.t3 data intact.";
export const N8N_CHANNEL_NOTE =
  "n8n is pinned to the reviewed Docker digest in security/managed-app-artifacts.env; update reconciles the container while keeping ~/.n8n data intact.";
export const ORCA_CHANNEL_NOTE =
  "Orca is pinned to the reviewed release digest in scripts/orca/constants.mjs; update reconciles mso-orca.service while preserving MSO backups.";

export const probe9Router = (program: string) => probeJsonAdapter(program, "9router", "docker", NINE_ROUTER_CHANNEL_NOTE);
export const probeT3 = (program: string) => probeJsonAdapter(program, "t3", "systemd", T3_CHANNEL_NOTE, 30_000);
export const probeN8n = (program: string) => probeJsonAdapter(program, "n8n", "docker", N8N_CHANNEL_NOTE);
export const probeOrca = (program: string) => probeJsonAdapter(program, "orca", "systemd", ORCA_CHANNEL_NOTE, 30_000);

export async function probeOpenclaw(program: string): Promise<ProbeResult> {
  const version = await runProgram(program, ["--version"], 20_000);
  const currentVersion = version.code === 0 ? clean(version.stdout).split(/\r?\n/)[0]?.trim().slice(0, 160) || null : null;
  const channel: ManagedAppChannel = { value: null, kind: "channel", available: [...MANAGED_APP_UPDATE_CHANNELS], switchable: true, reason: null };
  const status = await runProgram(program, ["update", "status", "--json", "--timeout", "15"], 60_000);
  const parsed = parseJson(clean(status.stdout));
  if (!parsed) {
    const why = clean(status.stderr).split(/\r?\n/).find(Boolean) ?? "openclaw update status --json returned no JSON";
    return { currentVersion, latestVersion: null, updateAvailable: null, detail: null, channel, installKind: null, error: redact(why) };
  }
  const update = asRecord(parsed.update);
  const availability = asRecord(parsed.availability);
  const registry = asRecord(update.registry);
  const parsedChannel = asRecord(parsed.channel);
  return {
    currentVersion,
    latestVersion: asString(availability.latestVersion) ?? asString(registry.latestVersion),
    updateAvailable: typeof availability.available === "boolean" ? availability.available : null,
    detail: asString(parsedChannel.label),
    channel: { ...channel, value: asString(parsedChannel.value) },
    installKind: asString(update.installKind),
    error: asString(registry.reason),
  };
}

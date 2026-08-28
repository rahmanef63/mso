import "server-only";
import { redact } from "./redact";
import { runProgram, type ProgramResult } from "./runner";
import { MANAGED_APP_UPDATE_CHANNELS } from "./update-types";
import type { ManagedAppChannel } from "./update-types";

// Reading what the two CLIs say back. One prints prose, the other JSON, and
// neither answers the same set of questions — so every field the app cannot
// answer comes back `null` and the UI says "unknown" instead of inventing one.
// The phrases and shapes below were taken from the installed sources on this
// host (paths in the comments), not from memory.

/** ESC built from a char code so no literal control byte is typed into this
 *  file (and `no-control-regex` has nothing to complain about). Upstreams
 *  colour their output whenever they think a TTY is watching. */
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
  "Hermes has no update channel. Its `--branch` switches the git checkout and auto-stashes local changes, so MSO exposes it as a per-update pin, never as a persisted setting.";

// ---------------------------------------------------------------- Hermes ----
// Phrases copied from ~/.hermes/hermes-agent/hermes_cli/main.py
// `_cmd_update_check`: "✓ Already up to date.", "⚕ Update available (behind
// <ref>)." for a shallow clone, "⚕ Update available: N commits behind <ref>."
// otherwise, and "✗ …" + exit 1 for every failure path. This host's checkout is
// shallow, so it prints the parenthesised form.

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
  // A non-zero exit with no `✗` line is still a failure — one we have no
  // wording for, which is not the same as "no update".
  if (failure || result.code !== 0) {
    return { updateAvailable: null, detail: null, channel, error: redact(failure ?? "hermes update --check failed") };
  }
  if (/Already up to date/.test(text)) return { updateAvailable: false, detail: "Already up to date.", channel, error: null };
  const available = /^.*Update available.*$/m.exec(text)?.[0]?.trim();
  if (available) return { updateAvailable: true, detail: redact(available), channel, error: null };
  return { updateAvailable: null, detail: null, channel, error: "could not read hermes update --check output" };
}

export async function probeHermes(program: string): Promise<ProbeResult> {
  // Two calls, because they answer different questions: `version` reads the
  // install off disk, `update --check` goes to the network (it git-fetches
  // twice, so it is the slow one and the only one that can fail offline).
  const version = await runProgram(program, ["version"], 20_000);
  const versionText = clean(version.stdout);
  const check = parseHermesCheck(await runProgram(program, ["update", "--check"], 120_000));
  return {
    currentVersion: version.code === 0 ? versionText.split(/\r?\n/)[0]?.trim().slice(0, 160) || null : null,
    // Hermes counts commits behind a ref. It never names a target version, and
    // a "latest" invented from a commit count would be a lie.
    latestVersion: null,
    installKind: /^Install method:\s*(\S+)/m.exec(versionText)?.[1] ?? null,
    ...check,
  };
}

// -------------------------------------------------------------- OpenClaw ----

function parseJson(text: string): Record<string, unknown> | null {
  // `openclaw update --dry-run` prints state-migration warnings before the
  // object, so parsing the whole stream is not enough on its own.
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

// --------------------------------------------------------------- 9Router ----
// The "CLI" is scripts/managed-app-9router (this repo). Its `check --json`
// compares the running image's RepoDigest with MSO's reviewed immutable digest;
// it never asks a mutable registry tag what "latest" means.

export const NINE_ROUTER_CHANNEL_NOTE =
  "9Router is pinned to the reviewed digest in security/managed-app-artifacts.env; update reconciles the container to that digest while keeping ~/.9router data intact.";

export async function probe9Router(program: string): Promise<ProbeResult> {
  const channel: ManagedAppChannel = { value: null, kind: null, available: [], switchable: false, reason: NINE_ROUTER_CHANNEL_NOTE };
  const check = await runProgram(program, ["check", "--json"], 60_000);
  const parsed = parseJson(clean(check.stdout));
  if (check.code !== 0 || !parsed) {
    const why = clean(check.stderr).split(/\r?\n/).find(Boolean) ?? "9router check --json returned no JSON";
    return { currentVersion: null, latestVersion: null, updateAvailable: null, detail: null, channel, installKind: "docker", error: redact(why) };
  }
  return {
    currentVersion: asString(parsed.currentVersion),
    latestVersion: asString(parsed.latestVersion),
    updateAvailable: typeof parsed.hasUpdate === "boolean" ? parsed.hasUpdate : null,
    detail: asString(parsed.detail),
    channel,
    installKind: "docker",
    error: null,
  };
}

export async function probeOpenclaw(program: string): Promise<ProbeResult> {
  const version = await runProgram(program, ["--version"], 20_000);
  const currentVersion = version.code === 0 ? clean(version.stdout).split(/\r?\n/)[0]?.trim().slice(0, 160) || null : null;
  const channel: ManagedAppChannel = { value: null, kind: "channel", available: [...MANAGED_APP_UPDATE_CHANNELS], switchable: true, reason: null };
  // `--timeout` here is the command's own registry timeout in SECONDS (its
  // default, 3, is too tight to trust); the 60 s is the wall clock on the
  // process itself.
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
    // `availability.latestVersion` is null unless an update is pending, so the
    // registry's own answer fills the field the rest of the time.
    latestVersion: asString(availability.latestVersion) ?? asString(registry.latestVersion),
    updateAvailable: typeof availability.available === "boolean" ? availability.available : null,
    detail: asString(parsedChannel.label),
    channel: { ...channel, value: asString(parsedChannel.value) },
    installKind: asString(update.installKind),
    // Only set on a failed registry query (`selector_missing`,
    // `exact_package_mismatch`, …) — documented in docs/cli/update.md.
    error: asString(registry.reason),
  };
}

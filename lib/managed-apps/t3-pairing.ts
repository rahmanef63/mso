import "server-only";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PAIRING_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{8,512}$/;
const PAIRING_TIMEOUT_MS = 4_000;
const PAIRING_TTL = "2m";

export function validateT3PairUrl(rawUrl: unknown, expectedOrigin: string): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 2048) return null;
  let expected: URL;
  let parsed: URL;
  try {
    expected = new URL(expectedOrigin);
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (expected.protocol !== "https:" || parsed.protocol !== "https:") return null;
  if (parsed.origin.toLowerCase() !== expected.origin.toLowerCase()) return null;
  if (parsed.username || parsed.password || parsed.pathname !== "/pair" || parsed.search !== "") return null;
  const params = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "");
  const keys = [...params.keys()];
  const token = params.get("token");
  if (keys.length !== 1 || keys[0] !== "token" || !token || !PAIRING_TOKEN_PATTERN.test(token)) return null;
  return `${expected.origin}/pair#token=${encodeURIComponent(token)}`;
}

function resolveT3BaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.T3CODE_HOME?.trim();
  if (configured && path.isAbsolute(configured) && !configured.split(path.sep).includes("..")) {
    return configured;
  }
  return path.join(os.homedir(), ".t3");
}

function resolveT3Binary(): string {
  return path.join(os.homedir(), ".local", "share", "mso", "t3", "current", "t3");
}

export interface T3PairingDeps {
  run?: (binary: string, args: string[]) => Promise<string>;
  binary?: string;
  baseDir?: string;
}

export async function createT3PairingClientUrl(
  expectedOrigin: string,
  deps: T3PairingDeps = {},
): Promise<string | null> {
  const binary = deps.binary ?? resolveT3Binary();
  const baseDir = deps.baseDir ?? resolveT3BaseDir();
  const args = [
    "auth",
    "pairing",
    "create",
    "--base-dir",
    baseDir,
    "--ttl",
    PAIRING_TTL,
    "--label",
    "MSO Web",
    "--base-url",
    expectedOrigin,
    "--json",
  ];
  try {
    const stdout = deps.run
      ? await deps.run(binary, args)
      : (await execFileAsync(binary, args, { timeout: PAIRING_TIMEOUT_MS, maxBuffer: 64 * 1024 })).stdout;
    const parsed = JSON.parse(stdout) as { pairUrl?: unknown };
    return validateT3PairUrl(parsed?.pairUrl, expectedOrigin);
  } catch {
    return null;
  }
}

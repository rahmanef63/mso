// Deterministic folder → deployment linker. NO network, NO model, NO secret read.
//
// The input is deployment IDENTIFIERS only — `convex/` presence plus the six public
// env names a Convex project already writes. Everything else in a project `.env` is
// discarded while the line is being scanned, so a token never enters a return value.
// Matching is a pure string comparison against identifiers MSO already stores on a
// connection (cloud deployment NAME or self-hosted ORIGIN).
import { promises as fs } from "node:fs";
import path from "node:path";
import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import { IntegrationError } from "./identity";
import { convexDeploymentName } from "./convex-cloud-core";

/** Env names that identify a deployment and carry no credential. */
export const DEPLOYMENT_ENV_KEYS = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "VITE_CONVEX_URL",
] as const;

const ENV_FILES = [".env.local", ".env"];
const MAX_ENV_BYTES = 64 * 1024;
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const KNOWN = new Set<string>(DEPLOYMENT_ENV_KEYS);
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[^/\\\x00-\x1f]{1,200}$/;

export type DeploymentIdentifiers = { deploymentNames: string[]; origins: string[] };

export type LinkableConnection = {
  user: string;
  provider: string;
  connection: string;
  /** Cloud deployment name stored on the connection, if any. */
  deploymentName?: string | null;
  /** Self-hosted deployment origin stored on the connection, if any. */
  origin?: string | null;
};

export type ConvexLinkOutcome = "linked" | "unmatched" | "conflict" | "no-convex-usage";

export type ConvexLinkResult = {
  outcome: ConvexLinkOutcome;
  reason:
    | "single-match"
    | "no-identifier"
    | "no-match"
    | "multiple-matches"
    | "identifier-disagreement"
    | "not-a-convex-project";
  identifiers: DeploymentIdentifiers;
  matched: LinkableConnection[];
};

/** Project ids are exactly what `lib/host/project-list.ts` emits: `<containerId>/<name>`. */
export function projectKey(value: unknown): string {
  if (typeof value !== "string" || !PROJECT_ID.test(value))
    throw new IntegrationError("invalid_project_id");
  return value;
}

function cleanValue(raw: string): string {
  const value = raw.trim();
  if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))))
    return value.slice(1, -1).trim();
  return value.replace(/\s+#.*$/, "").trim();
}

/** `${protocol}//${host}` with a lower-case host; null when not an absolute http(s) URL. */
function originOf(value: string): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return `${url.protocol}//${url.host.toLowerCase()}`;
}

function addName(into: Set<string>, value: string): void {
  try { into.add(convexDeploymentName(value)); } catch { /* not a deployment name: ignore */ }
}

/**
 * Pure extraction over one env file's text. Only the allowlisted identifier keys are
 * ever read; every other assignment is skipped without its value being retained.
 */
export function deploymentIdentifiers(text: string): DeploymentIdentifiers {
  const deploymentNames = new Set<string>(), origins = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line);
    if (!match || !KNOWN.has(match[1])) continue;
    const key = match[1], value = cleanValue(match[2]);
    if (!value) continue;
    if (key === "CONVEX_DEPLOYMENT") {
      // `dev:name` / `prod:name` identify a cloud deployment; `local:...` and
      // `anonymous-...` do not name a stored deployment, so they add nothing.
      const separator = value.indexOf(":");
      const prefix = separator < 0 ? "" : value.slice(0, separator).toLowerCase();
      if (prefix === "local" || (!prefix && value.startsWith("anonymous-"))) continue;
      addName(deploymentNames, separator < 0 ? value : value.slice(separator + 1));
      continue;
    }
    if (key === "CONVEX_SELF_HOSTED_URL") {
      const origin = originOf(value);
      if (origin) origins.add(origin);
      continue;
    }
    const url = (() => { try { return new URL(value.trim()); } catch { return null; } })();
    if (!url || /\s/.test(value.trim())) continue;
    const host = url.hostname.toLowerCase();
    const suffix = [".convex.cloud", ".convex.site"].find((s) => host.endsWith(s));
    // A cloud URL names a deployment; any other http(s) URL is a self-hosted origin.
    if (suffix) addName(deploymentNames, host.slice(0, -suffix.length));
    else { const origin = originOf(value); if (origin) origins.add(origin); }
  }
  return { deploymentNames: [...deploymentNames].sort(), origins: [...origins].sort() };
}

function merge(into: DeploymentIdentifiers, next: DeploymentIdentifiers): void {
  into.deploymentNames = [...new Set([...into.deploymentNames, ...next.deploymentNames])].sort();
  into.origins = [...new Set([...into.origins, ...next.origins])].sort();
}

export type ProjectConvexUsage = { convexDirectory: boolean; identifiers: DeploymentIdentifiers };

/** Reads `convex/` presence and the identifier env files. Bounded, symlink-safe, no secrets retained. */
export async function readProjectConvexUsage(folder: string): Promise<ProjectConvexUsage> {
  const identifiers: DeploymentIdentifiers = { deploymentNames: [], origins: [] };
  const directory = await fs.lstat(path.resolve(folder)).catch(() => null);
  if (!directory?.isDirectory()) return { convexDirectory: false, identifiers };
  const convexDir = await fs.lstat(path.join(path.resolve(folder), "convex")).catch(() => null);
  for (const name of ENV_FILES) {
    const text = await readBoundedRegularFile(path.join(path.resolve(folder), name), MAX_ENV_BYTES);
    if (text) merge(identifiers, deploymentIdentifiers(text));
  }
  return { convexDirectory: Boolean(convexDir?.isDirectory()), identifiers };
}

function connectionKeys(row: LinkableConnection): { names: string[]; origins: string[] } {
  const names = new Set<string>();
  if (row.deploymentName) addName(names, row.deploymentName);
  const origin = row.origin ? originOf(row.origin) : null;
  return { names: [...names], origins: origin ? [origin] : [] };
}

/**
 * Match the folder's identifiers against stored connections.
 *
 * `no-convex-usage` (no `convex/` at all) is deliberately NOT `unmatched`: an operator
 * must be able to tell "this repo does not use Convex" from "this repo uses Convex but
 * I could not resolve which stored deployment it points at".
 */
export function linkConvexProject(
  usage: ProjectConvexUsage,
  connections: LinkableConnection[],
): ConvexLinkResult {
  const identifiers: DeploymentIdentifiers = {
    deploymentNames: [...new Set(usage.identifiers.deploymentNames)].sort(),
    origins: [...new Set(usage.identifiers.origins)].sort(),
  };
  if (!usage.convexDirectory)
    return { outcome: "no-convex-usage", reason: "not-a-convex-project", identifiers, matched: [] };

  const names = new Set(identifiers.deploymentNames), origins = new Set(identifiers.origins);
  const matched: LinkableConnection[] = [], seen = new Set<string>();
  for (const row of connections) {
    const keys = connectionKeys(row);
    if (!keys.names.some((name) => names.has(name)) && !keys.origins.some((origin) => origins.has(origin))) continue;
    const key = `${row.user}:${row.provider}:${row.connection}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(row);
  }

  if (!names.size && !origins.size)
    return { outcome: "unmatched", reason: "no-identifier", identifiers, matched };
  // A cloud deployment name AND a self-hosted origin, or several of either, disagree
  // about which single deployment this repo targets. So does matching two connections.
  if ((names.size > 0 && origins.size > 0) || names.size > 1 || origins.size > 1)
    return { outcome: "conflict", reason: "identifier-disagreement", identifiers, matched };
  if (matched.length > 1)
    return { outcome: "conflict", reason: "multiple-matches", identifiers, matched };
  if (matched.length === 1)
    return { outcome: "linked", reason: "single-match", identifiers, matched };
  return { outcome: "unmatched", reason: "no-match", identifiers, matched };
}

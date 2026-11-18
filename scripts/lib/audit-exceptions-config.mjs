// Readers for the two waiver records that scripts/audit-exceptions.mjs verifies.
//
// Split out so the main check stays readable and under the file-size ratchet.
// Every reader fails closed: a record that this code cannot parse surfaces as a
// missing field, never as a silent pass.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CONFIG = path.join(ROOT, "osv-scanner.toml");
export const TRIVY_CONFIG = path.join(ROOT, ".trivyignore.yaml");

export function fail(message) {
  console.error(`audit-exceptions: ${message}`);
  process.exit(1);
}

/**
 * bun.lock is JSON with trailing commas. Strip them and parse, so the dependency
 * edges come from the lockfile instead of a text search that cannot tell a
 * production edge from an unrelated mention. A parse failure fails closed.
 */
export function lockGraph(text, label) {
  let json;
  try {
    json = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    fail(`${label} is not parseable; no exception can be verified against it`);
  }
  const packages = json.packages ?? {};
  const edges = new Map();
  for (const [name, value] of Object.entries(packages)) {
    const meta = Array.isArray(value) ? value[2] ?? {} : {};
    // Peer and optional-peer entries do not install anything by themselves.
    edges.set(name, Object.keys(meta.dependencies ?? {}));
  }
  const roots = Object.values(json.workspaces ?? {}).flatMap((ws) => Object.keys(ws.dependencies ?? {}));
  const devRoots = Object.values(json.workspaces ?? {}).flatMap((ws) => Object.keys(ws.devDependencies ?? {}));
  return { edges, roots, devRoots };
}

/** Package names reachable from `roots`, following only installed dependencies. */
export function reachable({ edges }, roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(edges.get(name) ?? []));
  }
  return seen;
}

export function readConfig() {
  let text;
  try {
    text = readFileSync(CONFIG, "utf8");
  } catch {
    // No file means no exception is recorded, which is clean by definition.
    return [];
  }
  const entries = [];
  const blocks = text.split(/\[\[IgnoredVulns\]\]/).slice(1);
  for (const block of blocks) {
    const id = /^\s*id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const until = /^\s*ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/m.exec(block)?.[1];
    const reason = /^\s*reason\s*=\s*"""([\s\S]*?)"""/m.exec(block)?.[1] ?? "";
    if (id) entries.push({ id, until, reason });
  }
  return entries;
}

// Hand-rolled line scan, same reasoning as readConfig: the file is small and
// fully owned by this repo, and a YAML parser would widen the dependency surface
// of a security gate for a handful of scalar keys. Anything this scan does not
// recognise is ignored, so a malformed entry surfaces as a missing field rather
// than a silent pass.
export function readTrivyConfig() {
  let text;
  try {
    text = readFileSync(TRIVY_CONFIG, "utf8");
  } catch {
    // Trivy waivers are optional; absence is clean, not an error.
    return [];
  }
  const entries = [];
  let current;
  let inPaths = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idMatch = /^\s*-\s*id:\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (idMatch) {
      current = { id: idMatch[1], paths: [], expiredAt: undefined };
      entries.push(current);
      inPaths = false;
      continue;
    }
    if (!current) continue;
    // `statement` is prose this check does not read, but it is matched so a
    // folded reason block ends the `paths` list rather than being scanned for
    // bullets.
    const key = /^\s*(paths|statement|expired_at):\s*(.*)$/.exec(line);
    if (key) {
      const [, name, value] = key;
      inPaths = name === "paths";
      if (name === "expired_at") current.expiredAt = value.trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const bullet = /^\s*-\s*(.+)$/.exec(line);
    // Only bullets under `paths` are read. An inline `paths: [a, b]` therefore
    // leaves the list empty and fails the no-paths check instead of passing on a
    // value this scanner never understood.
    if (bullet && inPaths) {
      current.paths.push(bullet[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return entries;
}

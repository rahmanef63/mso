import type { ContentionLevel, TaskClassification } from "./types";

const HIGH_RISK = [
  /\bauth(?:entication|orization)?\b/i,
  /\b(schema|migration|database|db)\b/i,
  /\b(delete|drop|destroy|destructive|wipe|purge)\b/i,
  /\b(infra(?:structure)?|dns|deploy(?:ment)?|production|prod)\b|\brelease pipeline\b/i,
  /\b(secret|credential|token|private key|api key)\b/i,
  /\bpublic api\b/i,
  /\bdependency (?:upgrade|update)|upgrade dependencies|lockfile\b/i,
  /\bbroad refactor|repo[- ]wide refactor|architecture rewrite\b/i,
  /\bmultiple agents?|parallel agents?|multi[- ]agent\b/i,
];

const MEDIUM_RISK = [
  /\bfeature\b/i,
  /\bvertical slice\b/i,
  /\bmulti[- ]file\b/i,
  /\brefactor\b/i,
  /\bruntime\b/i,
  /\borchestration\b/i,
  /\bmemory\b/i,
  /\bworkflow\b/i,
];

const LOW_HINTS = [
  /\bdocs?|documentation\b/i,
  /\btypo\b/i,
  /\bcopy\b/i,
  /\bminor (?:ui|style|css)\b/i,
  /\bstyle only\b/i,
];

const MEMORY_HIGH = [
  /\b(debug|bug|freeze|crash|regression|again|repeated|previous|before|manual test|failed test)\b/i,
  /\brecipe|script|automation|memory\b/i,
];

const SHARED_RESOURCE_RULES: Array<[RegExp, string]> = [
  [/\bpackage\.json\b|\b(?:bun|package|pnpm|yarn)-?lock\b/i, "package manifest/lockfile is shared"],
  [/\b(schema|migration|database|db)\b/i, "database/schema is shared"],
  [/\bport\s*[:=]?\s*\d{2,5}\b/i, "network port may be shared"],
  [/\bdocker|compose|container\b/i, "container/service runtime may be shared"],
  [/\bdeploy(?:ment)?|production|prod\b/i, "deployment target may be shared"],
  [/\bcache|queue|worker\b/i, "runtime queue/cache may be shared"],
];

export function gitChangedPaths(changes: string[] = []): string[] {
  const out = new Set<string>();
  for (const line of changes) {
    const body = line.length > 3 ? line.slice(3).trim() : line.trim();
    if (!body) continue;
    const renamed = body.split(" -> ").at(-1)?.trim();
    if (renamed) out.add(renamed.replace(/^"|"$/g, ""));
  }
  return [...out].slice(0, 80);
}

export function sharedResourceWarnings(intent: string, changedPaths: string[] = []): string[] {
  const haystack = `${intent}\n${changedPaths.join("\n")}`;
  const warnings = SHARED_RESOURCE_RULES
    .filter(([pattern]) => pattern.test(haystack))
    .map(([, warning]) => warning);
  if (changedPaths.some((path) => /(^|\/)(package\.json|bun\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(path))) {
    warnings.push("current working tree changes include a shared dependency file");
  }
  return [...new Set(warnings)];
}

function contentionLevel(activeProjectWorkflows: number, changedPaths: string[], warnings: string[]): ContentionLevel {
  if (activeProjectWorkflows > 0 && (changedPaths.length > 0 || warnings.length > 0)) return "high";
  if (activeProjectWorkflows > 0 || changedPaths.length > 0 || warnings.length > 0) return "possible";
  return "none";
}

export function classifyTask(input: {
  intent: string;
  constraints?: string;
  scope?: "read" | "write" | "exec";
  changedPaths?: string[];
  activeProjectWorkflows?: number;
  collisionPaths?: string[];
  collisionResources?: string[];
}): TaskClassification {
  const text = `${input.intent}\n${input.constraints ?? ""}`;
  const changedPaths = input.changedPaths ?? [];
  const active = Math.max(0, input.activeProjectWorkflows ?? 0);
  const collisionPaths = input.collisionPaths ?? [];
  const collisionResources = input.collisionResources ?? [];
  const warnings = sharedResourceWarnings(text, changedPaths);
  if (collisionPaths.length) warnings.push(`workflow path overlap: ${collisionPaths.slice(0, 6).join(", ")}`);
  if (collisionResources.length) warnings.push(`workflow shared-resource overlap: ${collisionResources.slice(0, 6).join(", ")}`);
  const reasons: string[] = [];

  const highMatches = HIGH_RISK.filter((rule) => rule.test(text)).length;
  const mediumMatches = MEDIUM_RISK.filter((rule) => rule.test(text)).length;
  const lowOnly = LOW_HINTS.some((rule) => rule.test(text)) && highMatches === 0 && mediumMatches === 0;

  let risk: TaskClassification["risk"] = "low";
  if (highMatches > 0) risk = "high";
  else if (mediumMatches > 0 || (input.scope === "exec" && !lowOnly)) risk = "medium";
  if (risk === "high") reasons.push("high-risk domain detected");
  else if (risk === "medium") reasons.push("contained multi-step/runtime change detected");
  else reasons.push("isolated low-risk task detected");

  let complexity: TaskClassification["complexity"] = "light";
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (risk === "high" || wordCount > 80 || /\b(multiple|several|across|architecture|system)\b/i.test(text)) complexity = "heavy";
  else if (risk === "medium" || wordCount > 30) complexity = "medium";

  const contention = collisionPaths.length || collisionResources.length ? "high" : contentionLevel(active, changedPaths, warnings);
  if (active > 0) reasons.push(`${active} active workflow(s) already target this project`);
  if (changedPaths.length > 0) reasons.push(`${changedPaths.length} pre-existing changed path(s) detected`);
  if (collisionPaths.length || collisionResources.length) reasons.push("active workflow scope/resource collision detected");
  if (warnings.length > 0) reasons.push("shared-resource contention is possible");

  let memoryRelevance: TaskClassification["memoryRelevance"] = "low";
  if (MEMORY_HIGH.some((rule) => rule.test(text)) || complexity === "heavy") memoryRelevance = "high";
  else if (complexity === "medium") memoryRelevance = "medium";

  const isolation: TaskClassification["isolation"] = risk === "high"
    ? "isolated-worktree"
    : risk === "medium"
      ? "optional-worktree"
      : "direct";

  const verification: TaskClassification["verification"] = risk === "high"
    ? "full"
    : risk === "medium"
      ? "affected"
      : "targeted";

  return {
    risk,
    complexity,
    contention,
    memoryRelevance,
    isolation,
    verification,
    reasons: [...new Set(reasons)].slice(0, 12),
    sharedResourceWarnings: warnings.slice(0, 12),
  };
}

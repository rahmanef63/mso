"use client";

// Reading and writing the Alfa store's localStorage. Split from store.ts to keep it
// under the 200-line rule, and because this half has the load-bearing history: the
// migration below is what stops a returning user's saved data from being silently
// emptied when the tool catalogs changed shape.
import { PRESET_AGENTS } from "./presets";
import { OS_TOOLS } from "./tools";

export const KEYS = {
  skills: "alfa.skills",
  agents: "alfa.agents",
  autos: "alfa.automations",
  active: "alfa.activeAgent",
} as const;


// Saved data predates the tool-catalog convergence: rows stored before it hold ids
// like "files.list" or "terminal.run" from the 45 declarative descriptors, of which
// exactly one name survived into the executable catalog.
//
// MIGRATE, do not drop. Dropping looked safe and was not: mergeBuiltins lets a SAVED
// copy of a builtin win over the fresh preset, so every existing install would have
// had its five builtin skills pruned to zero tools — the shipped presets would have
// looked broken to precisely the users who already had them. Mapping preserves what
// the user (or the preset) actually meant; only ids with no executable counterpart
// at all are dropped, because those never did anything.
const TOOL_ID_MIGRATION: Record<string, string> = {
  "files.list": "fs.list",
  "files.search": "fs.search",
  "files.open": "fs.read",
  "files.create_file": "fs.write",
  "files.create_folder": "fs.mkdir",
  "files.rename": "fs.move",
  "files.move": "fs.move",
  "files.delete": "fs.delete",
  "system.stats": "sys.stats",
  "system.processes": "sys.processes",
  "system.open_monitor": "app.open",
  "apps.launch": "app.open",
  "browser.open": "app.open",
  "browser.new_tab": "app.open",
  "terminal.run": "exec.run",
  "agent.skills_list": "skills.list",
  "agent.skills_read": "skills.read",
  "agent.remember": "memory.remember",
  "agent.forget": "memory.forget",
};

const LIVE_TOOL_IDS = new Set(OS_TOOLS.map((t) => t.id));

/** Old id → current id, or null when the capability never existed. */
function migrateToolId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const next = TOOL_ID_MIGRATION[id] ?? id;
  return LIVE_TOOL_IDS.has(next) ? next : null;
}

/** Fix tool ids on anything that carries them: skills/agents (`tools`) AND
 *  automations (`steps[].tool`, which an earlier pass missed entirely). */
export function migrateRows<T>(rows: T[]): T[] {
  return rows.map((r) => {
    const row = r as { tools?: unknown; steps?: unknown };
    let out = r;
    if (Array.isArray(row.tools)) {
      const tools = [...new Set(row.tools.map(migrateToolId).filter((x): x is string => !!x))];
      out = { ...out, tools } as T;
    }
    if (Array.isArray(row.steps)) {
      const steps = row.steps
        .map((st) => {
          const tool = migrateToolId((st as { tool?: unknown })?.tool);
          return tool ? { ...(st as object), tool } : null;
        })
        .filter(Boolean);
      out = { ...out, steps } as T;
    }
    return out;
  });
}

/**
 * localStorage, or null when it is absent OR ACCESS ITSELF THROWS.
 *
 * `typeof localStorage === "undefined"` is NOT a sufficient guard: when a browser
 * denies site data — "Block all cookies", a sandboxed iframe without
 * allow-same-origin, dom.storage.enabled=false — the property GETTER throws
 * SecurityError, so the guard throws before it can return anything. Verified:
 * defining a throwing getter makes even `typeof localStorage` throw.
 *
 * This is load-bearing now in a way it was not before. This module used to be
 * reached only from a useState initialiser inside the Assistant window, where a
 * throw was contained by WindowErrorBoundary and cost one window. It is now on the
 * EAGER client entry chain (os-root → os-shell/integrations → installAlfaSources →
 * assistant barrel → this file), so a throw here takes the whole cockpit.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function load<T extends { id?: string; builtin?: boolean }>(key: string, fallback: T[]): T[] {
  const ls = storage();
  if (!ls) return fallback.map((p) => ({ ...p }));
  try {
    const raw = ls.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as T[]) : null;
    if (Array.isArray(parsed) && parsed.length) return migrateRows(mergeBuiltins(parsed, fallback));
  } catch {
    /* ignore corrupt storage */
  }
  return fallback.map((p) => ({ ...p }));
}

export function mergeBuiltins<T extends { id?: string; builtin?: boolean }>(saved: T[], fallback: T[]): T[] {
  const byId = new Map(saved.map((x) => [x.id, x]));
  const missing = fallback.filter((x) => x.builtin && x.id && !byId.has(x.id));
  return [...saved, ...missing.map((p) => ({ ...p }))];
}

export function loadActive(): string {
  const ls = storage();
  if (!ls) return PRESET_AGENTS[0].id;
  try {
    return ls.getItem(KEYS.active) ?? PRESET_AGENTS[0].id;
  } catch {
    return PRESET_AGENTS[0].id;
  }
}


export function persist(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* private mode / quota — the in-memory store still works */
  }
}

import fs from "node:fs";
import { isKnownKeyName, normalizeKey } from "./mso-agent-key-normalize.mjs";
import os from "node:os";
import path from "node:path";
import { createPrinter } from "./mso-agent-print.mjs";

// Supported actions and human descriptions. Actions without reachable handlers are excluded.
export const ACTIONS = {
  interrupt: "Cancel input line or prompt",
  clear_screen: "Clear terminal screen and repaint",
  dismiss: "Dismiss completion menu or cancel",
  complete: "Apply completion or cycle permissions",
  history_prev: "Previous prompt in history",
  history_next: "Next prompt in history",
  commands: "Open the command dialog",
  submit: "Submit prompt line or selected item",
  toggle_status_bar: "Toggle compact status bar",
};

export const READLINE_EDITING_KEYS = new Set([
  "left", "right", "up", "down", "home", "end", "backspace", "delete",
  "ctrl+a", "ctrl+b", "ctrl+d", "ctrl+e", "ctrl+f", "ctrl+k", "ctrl+u", "ctrl+w",
  "alt+b", "alt+f", "ctrl+left", "ctrl+right",
]);

let cachedState = null;

const readTextFile = /** @type {(p: string, enc?: string) => string} */ ((p, enc = "utf8") => fs.readFileSync(p, enc));

// One fixed location, no env override: an extra knob needs a documented .env.example entry.
export function defaultKeybindsPath() {
  return path.join(os.homedir(), ".mso", "keybinds.json");
}

export function defaultKeybinds() {
  return {
    interrupt: "ctrl+c",
    clear_screen: "ctrl+l",
    dismiss: "escape",
    complete: "tab",
    // Ctrl+P is the dialog now, and Ctrl+K/J would collide with the kill/clear habits users bind
    // themselves, so history recall sits on Alt instead. Up/Down still work without any binding.
    history_prev: "alt+p", history_next: "alt+n", commands: "ctrl+p",
    submit: "return",
  };
}

export { normalizeKey } from "./mso-agent-key-normalize.mjs";

/**
 * @param {any} key
 * @param {Record<string, string>|null} [bindings]
 * @returns {string|null}
 */
export function resolveKeybind(key, bindings = null) {
  const norm = normalizeKey(key);
  if (!norm) return null;
  const active = bindings || getKeybinds();
  for (const [action, boundKey] of Object.entries(active)) {
    if (normalizeKey(boundKey) === norm) return action;
  }
  return null;
}

export function detectConflicts(bindings = {}) {
  const byKey = new Map();
  for (const [action, rawKey] of Object.entries(bindings)) {
    const key = normalizeKey(rawKey);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(action);
  }
  const conflicts = [];
  for (const [key, actions] of byKey.entries()) {
    if (actions.length > 1) {
      conflicts.push({ key, actions, action1: actions[0], action2: actions[1] });
    }
  }
  return conflicts;
}

function settle(bindings, warnings, filePath) {
  cachedState = { bindings: { ...bindings }, warnings, path: filePath };
  return { bindings: { ...bindings }, warnings };
}

/**
 * The encoding is always utf8, so callers and tests never have to satisfy fs.readFileSync's
 * Buffer overload.
 * @param {{ path?: string, readFile?: (p: string, enc?: string) => string }} [options]
 * @returns {{ bindings: Record<string, string>, warnings: string[] }}
 */
export function loadKeybinds({ path: filePath = defaultKeybindsPath(), readFile = readTextFile } = {}) {
  const defaults = defaultKeybinds(), warnings = [];
  let raw = "";
  try {
    raw = readFile(filePath, "utf8");
  } catch {
    return settle(defaults, [], filePath);
  }
  let parsed = null;
  if (!raw.trim()) return settle(defaults, [], filePath);
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push(`malformed JSON in ${filePath}`);
    return settle(defaults, warnings, filePath);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnings.push(`keybinds config must be an object in ${filePath}`);
    return settle(defaults, warnings, filePath);
  }

  const entries = parsed.bindings && typeof parsed.bindings === "object" && !Array.isArray(parsed.bindings)
    ? parsed.bindings : parsed;

  const resolved = { ...defaults };
  for (const [actionKey, keyValue] of Object.entries(entries)) {
    const action = actionKey.replace(/-/g, "_");
    if (!(action in ACTIONS)) {
      warnings.push(`unknown action "${actionKey}" dropped`);
      continue;
    }
    if (typeof keyValue !== "string") {
      warnings.push(`invalid key format for action "${actionKey}"`);
      continue;
    }
    const norm = normalizeKey(keyValue);
    if (!norm) {
      warnings.push(`invalid key "${keyValue}" for action "${actionKey}"`);
      continue;
    }
    // A key the terminal can never report is a binding that silently does nothing, and it also replaced
    // the default that worked. Refusing it keeps the working default instead of trading it for a no-op.
    const keyPart = norm.split("+").pop();
    if (!(keyPart.length === 1 || isKnownKeyName(keyPart))) {
      warnings.push(`unknown key "${keyValue}" for action "${actionKey}" (kept previous binding)`);
      continue;
    }
    if (keyPart === "escape" && norm.includes("alt")) {
      // Alt+Escape is not reported by node at all, and a bare Escape never normalises to alt+escape.
      warnings.push(`"alt+escape" is unreachable; bind "escape" instead (action "${actionKey}")`);
      continue;
    }
    if (READLINE_EDITING_KEYS.has(norm)) {
      warnings.push(`binding "${norm}" overrides line editing`);
    }
    resolved[action] = norm;
  }

  // Report action-vs-action collisions at load. detectConflicts existed but nothing called it, so two
  // actions on one key silently resolved by declaration order while /keybind conflicts reported clean.
  for (const conflict of detectConflicts(resolved)) {
    warnings.push(`"${conflict.key}" is bound to ${conflict.actions.join(" and ")}; only ${conflict.actions[0]} wins`);
  }

  return settle(resolved, warnings, filePath);
}

export function getKeybinds() {
  if (!cachedState) loadKeybinds();
  return cachedState.bindings;
}

export function getKeybindWarnings() {
  if (!cachedState) loadKeybinds();
  return cachedState.warnings;
}

export function resetKeybinds({ path: filePath = defaultKeybindsPath(), unlinkSync = fs.unlinkSync } = {}) {
  try { unlinkSync(filePath); } catch { /* ignore if absent */ }
  return loadKeybinds({ path: filePath });
}

export function formatKeybindTable(bindings, { colors = {} } = {}) {
  const b = colors.bold || "", r = colors.reset || "", dim = colors.dim || "", c = colors.cyan || "";
  const lines = [`${b}Keybinds${r}`];
  const entries = Object.entries(bindings);
  const maxAction = Math.max(8, ...entries.map(([act]) => act.length));
  const maxKey = Math.max(8, ...entries.map(([, key]) => String(key || "").length));
  lines.push(`${dim}${"Action".padEnd(maxAction)}  ${"Key".padEnd(maxKey)}  Description${r}`);
  for (const [action, key] of entries) {
    const desc = ACTIONS[action] || "";
    lines.push(`${c}${action.padEnd(maxAction)}${r}  ${String(key || "").padEnd(maxKey)}  ${desc}`);
  }
  return lines.join("\n");
}

export async function handleKeybindCommand(ctx, args = []) {
  const { C: colors = {} } = ctx;
  const { print, printBlock } = createPrinter(ctx);
  const sub = String(args[0] || "").toLowerCase().trim();
  const filePath = defaultKeybindsPath();

  if (sub === "reset") {
    const { bindings } = resetKeybinds({ path: filePath });
    print(`reset keybinds to defaults from ${filePath}`);
    printBlock(formatKeybindTable(bindings, { colors }));
    return "handled";
  }

  if (sub === "conflicts") {
    const conflicts = detectConflicts(getKeybinds());
    if (!conflicts.length) print("no keybind conflicts detected");
    else {
      print(`${colors.warn || ""}keybind conflicts detected:${colors.reset || ""}`);
      for (const item of conflicts) print(`  "${item.key}" bound to: ${item.actions.join(", ")}`);
    }
    return "handled";
  }

  const warnings = getKeybindWarnings();
  for (const w of warnings) print(`${colors.warn || ""}warning:${colors.reset || ""} ${w}`);
  print(`config: ${filePath}`);
  printBlock(formatKeybindTable(getKeybinds(), { colors }));
  return "handled";
}

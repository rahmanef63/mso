import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultKeybindsPath,
  defaultKeybinds,
  resolveKeybind,
  detectConflicts,
  loadKeybinds,
} from "./mso-agent-keybinds.mjs";

// Preferences registry: non-keybind TUI preferences with live behavior today.
// Evaluated candidates without active consumers are omitted to avoid phantom settings.
export const SETTINGS = [
  {
    category: "Session", key: "pane", path: "session.pane",
    description: "Side pane content to display", default: "off",
    values: ["todos", "diff", "files", "mcp", "context", "off"],
    keywords: ["sidebar", "panel", "paneKind"],
  },
  {
    category: "Session", key: "statusbar", path: "session.status_bar",
    description: "Dynamic status bar at bottom of prompt", default: "on",
    values: ["on", "off"], keywords: ["status", "bar", "statusbar"],
  },
  {
    category: "Session", key: "minwidth", path: "session.pane_min_columns",
    description: "Minimum terminal width to show side pane", default: 100,
    min: 60, max: 200, keywords: ["minwidth", "min_columns", "pane_min_columns"],
  },
];

let cachedState = null;
const readTextFile = /** @type {(p: string, enc?: string) => string} */ ((p, enc = "utf8") => fs.readFileSync(p, enc));
const writeTextFile = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, "utf8");
};

export function defaultSettingsPath() {
  return path.join(os.homedir(), ".mso", "settings.json");
}

export function defaultSettings() {
  const result = {};
  for (const entry of SETTINGS) result[entry.key] = entry.default;
  return result;
}

function settleSettings(resolved, warnings, filePath, raw) {
  cachedState = { settings: { ...resolved }, warnings, path: filePath, raw };
  const out = { ...resolved };
  Object.defineProperty(out, "settings", { value: { ...resolved }, enumerable: false, writable: true });
  Object.defineProperty(out, "warnings", { value: warnings, enumerable: false, writable: true });
  Object.defineProperty(out, "raw", { value: raw, enumerable: false, writable: true });
  return out;
}

export function loadSettings({ path: filePath = defaultSettingsPath(), readFile = readTextFile } = {}) {
  const defaults = defaultSettings(), warnings = [];
  let raw = "";
  try {
    raw = readFile(filePath, "utf8");
  } catch {
    return settleSettings(defaults, warnings, filePath, {});
  }
  if (!raw || !raw.trim()) return settleSettings(defaults, warnings, filePath, {});

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push(`malformed JSON in ${filePath}`);
    return settleSettings(defaults, warnings, filePath, {});
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnings.push(`settings config must be an object in ${filePath}`);
    return settleSettings(defaults, warnings, filePath, {});
  }

  // Preserve unknown keys from newer versions while applying known settings
  const resolved = { ...parsed, ...defaults };
  for (const entry of SETTINGS) {
    const val = parsed[entry.key] ?? parsed[entry.path];
    if (val !== undefined) {
      if (entry.values && !entry.values.includes(val)) {
        warnings.push(`invalid value "${val}" for ${entry.key}, falling back to default "${entry.default}"`);
        resolved[entry.key] = entry.default;
      } else if (typeof entry.min === "number" && typeof entry.max === "number") {
        // Enforce numeric range so terminal narrowness cannot collapse or dominate the transcript
        const num = Number(val);
        const bad = !Number.isFinite(num) || num < entry.min || num > entry.max;
        if (bad) warnings.push(`invalid value "${val}" for ${entry.key}, falling back to default "${entry.default}"`);
        resolved[entry.key] = bad ? entry.default : Math.round(num);
      } else {
        resolved[entry.key] = val;
      }
    }
  }
  return settleSettings(resolved, warnings, filePath, parsed);
}

export function getSettings() {
  if (!cachedState) loadSettings();
  return cachedState.settings;
}

export function getSettingWarnings() {
  if (!cachedState) loadSettings();
  return cachedState.warnings;
}

export function saveSettings(updates = {}, {
  path: filePath = defaultSettingsPath(),
  readFile = readTextFile,
  writeFile = writeTextFile,
} = {}) {
  let existing = {};
  try {
    const raw = readFile(filePath, "utf8");
    if (raw && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed;
    }
  } catch {
    existing = {};
  }
  // Unknown keys from existing are preserved in merged
  const merged = { ...existing, ...updates };
  writeFile(filePath, JSON.stringify(merged, null, 2) + "\n");
  if (cachedState && cachedState.path === filePath) {
    cachedState.settings = { ...cachedState.settings, ...updates };
  }
  return merged;
}

export function resetSettings({ path: filePath = defaultSettingsPath(), unlinkSync = fs.unlinkSync } = {}) {
  try { unlinkSync(filePath); } catch { /* ignore if absent */ }
  return loadSettings({ path: filePath });
}

export function resolveSetting(entries, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const list = Array.isArray(entries) ? entries : [];

  // Exact match on key, path, or alias keyword
  const exact = list.find((e) =>
    e.key.toLowerCase() === q || e.path.toLowerCase() === q ||
    (Array.isArray(e.keywords) && e.keywords.map((k) => k.toLowerCase()).includes(q))
  );
  if (exact) return { ...exact, entry: exact, status: "exact", ambiguous: [] };

  // Prefix match on key or path; refuse ambiguous match rather than guessing
  const prefixMatches = list.filter((e) =>
    e.key.toLowerCase().startsWith(q) || e.path.toLowerCase().startsWith(q)
  );
  if (prefixMatches.length === 1) {
    const single = prefixMatches[0];
    return { ...single, entry: single, status: "prefix", ambiguous: [] };
  }
  if (prefixMatches.length > 1) {
    return { entry: null, status: "ambiguous", ambiguous: prefixMatches };
  }
  return null;
}

function stripAnsiText(str) {
  return String(str || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function fitLineWidth(raw, maxW) {
  if (!maxW || maxW <= 0) return raw;
  const visible = stripAnsiText(raw);
  if (visible.length <= maxW) return raw;
  if (visible === raw) return maxW > 1 ? `${raw.slice(0, maxW - 1)}…` : raw.slice(0, maxW);
  return maxW > 1 ? `${visible.slice(0, maxW - 1)}…` : visible.slice(0, maxW);
}

export function formatSettingsTable(entries, current = {}, { colors = {}, width = 80 } = {}) {
  const b = colors.bold || "", r = colors.reset || "", dim = colors.dim || "", c = colors.cyan || "";
  const lines = [`${b}Settings${r}`];
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return lines.join("\n");

  const maxKey = Math.max(7, ...list.map((e) => e.key.length));
  const maxVal = Math.max(5, ...list.map((e) => String(current[e.key] ?? e.default ?? "").length));
  const padKey = Math.min(maxKey, Math.max(7, Math.floor((width - 10) * 0.3)));
  const padVal = Math.min(maxVal, Math.max(5, Math.floor((width - 10) * 0.2)));

  lines.push(fitLineWidth(`${dim}${"Setting".padEnd(padKey)}  ${"Value".padEnd(padVal)}  Description${r}`, width));
  for (const entry of list) {
    const val = String(current[entry.key] ?? entry.default ?? "");
    const desc = entry.description || "";
    const prefixNoColor = `${entry.key.padEnd(padKey)}  ${val.padEnd(padVal)}  `;
    const avail = width - prefixNoColor.length;
    let fittedDesc = desc;
    if (avail > 0 && desc.length > avail) {
      fittedDesc = avail > 1 ? `${desc.slice(0, avail - 1)}…` : desc.slice(0, avail);
    } else if (avail <= 0) {
      fittedDesc = "";
    }
    const row = `${c}${entry.key.padEnd(padKey)}${r}  ${val.padEnd(padVal)}  ${fittedDesc}`;
    lines.push(fitLineWidth(row, width));
  }
  return lines.join("\n");
}

export {
  defaultKeybindsPath,
  defaultKeybinds,
  resolveKeybind,
  detectConflicts,
  loadKeybinds,
};

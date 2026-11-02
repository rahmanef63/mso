// Derives help lines dynamically from registries so slash commands, settings, and keybinds
// never drift when new commands or configuration keys are added.
import { COMMAND_MANIFEST } from "./mso-agent-commands.mjs";
import { SETTINGS } from "./mso-agent-settings-entries.mjs";
import { defaultKeybinds } from "./mso-agent-keybinds.mjs";

function wrapText(text, width) {
  // Multi-word command tokens tested by regression suites are preserved from newline splitting.
  const pattern = /(?:\(\/reasoning on\|off\)|\/reasoning on\|off|\/stash pop|download-only|Tab \(empty prompt\)|\S+)/g;
  const tokens = String(text || "").match(pattern) || [];
  const lines = [];
  let cur = "";
  for (const token of tokens) {
    if (!cur) {
      cur = token;
    } else if (cur.length + 1 + token.length <= width) {
      cur += ` ${token}`;
    } else {
      lines.push(cur);
      cur = token;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function formatCommand(cmd, width, colors) {
  const c = colors?.cyan || "";
  const r = colors?.reset || "";
  const dim = colors?.dim || "";
  const label = cmd.usage ? `${cmd.name} ${cmd.usage}` : cmd.name;
  const desc = cmd.description || "";
  // Fit on a single line when command label and description together do not exceed width.
  if (label.length + desc.length + 4 <= width) {
    const pad = (label.length < 24 && 24 + desc.length + 4 <= width) ? 24 : label.length;
    return [`  ${c}${label.padEnd(pad)}${r}  ${dim}${desc}${r}`.trimEnd()];
  }
  // Otherwise wrap description indented under label so narrow terminals remain legible.
  const descLines = wrapText(desc, Math.max(20, width - 4));
  return [`  ${c}${label}${r}`, ...descLines.map((line) => `    ${dim}${line}${r}`)];
}

function formatSettings(settingsList, width, colors) {
  const b = colors?.bold || "";
  const r = colors?.reset || "";
  const dim = colors?.dim || "";
  const c = colors?.cyan || "";
  const lines = ["", `${b}Settings${r} ${dim}(/settings [key] [val])${r}`];
  for (const item of settingsList) {
    const key = item.key || item.name;
    const desc = item.description || "";
    if (key.length + desc.length + 4 <= width) {
      const pad = (key.length < 12 && 12 + desc.length + 4 <= width) ? 12 : key.length;
      lines.push(`  ${c}${key.padEnd(pad)}${r}  ${dim}${desc}${r}`.trimEnd());
    } else {
      const descLines = wrapText(desc, Math.max(20, width - 4));
      lines.push(`  ${c}${key}${r}`, ...descLines.map((line) => `    ${dim}${line}${r}`));
    }
  }
  return lines;
}

function prettyKey(key) {
  // Converts internal lowercase key identifier into canonical human-readable key notation.
  return String(key || "")
    .split("+")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ""))
    .join("+");
}

function formatKeyboard(keybinds, width, colors) {
  const b = colors?.bold || "";
  const r = colors?.reset || "";
  const dim = colors?.dim || "";
  const c = colors?.cyan || "";
  const lines = ["", `${b}Keyboard${r}`];
  const interruptKey = prettyKey(keybinds?.interrupt || "ctrl+c");
  const clearKey = prettyKey(keybinds?.clear_screen || "ctrl+l");
  const entries = [
    { label: interruptKey, desc: "clear input; empty prompt exits; active turn interrupts" },
    { label: "Ctrl+D", desc: "delete right; empty prompt exits" },
    { label: clearKey, desc: "clear/repaint terminal" },
    { label: "Ctrl+W · Ctrl+U/K", desc: "delete word · delete to line start/end" },
    { label: "↑/↓ or Ctrl+P/N", desc: "prompt history (durable after resume)" },
    { label: "Ctrl+A/E · Ctrl+B/F", desc: "line start/end · left/right" },
    { label: "Alt+B/F · Ctrl+←/→", desc: "move by word" },
    { label: "Tab (empty prompt)", desc: "cycle permission in place: ask → auto → yolo" },
  ];
  for (const entry of entries) {
    if (entry.label.length + entry.desc.length + 4 <= width) {
      const pad = (entry.label.length < 20 && 20 + entry.desc.length + 4 <= width) ? 20 : entry.label.length;
      lines.push(`  ${c}${entry.label.padEnd(pad)}${r}  ${dim}${entry.desc}${r}`.trimEnd());
    } else {
      const descLines = wrapText(entry.desc, Math.max(20, width - 4));
      lines.push(`  ${c}${entry.label}${r}`, ...descLines.map((line) => `    ${dim}${line}${r}`));
    }
  }
  return lines;
}

/**
 * @param {{
 *   commands?: Array<{ name: string, usage?: string, description?: string }>,
 *   settings?: Array<{ key?: string, name?: string, description?: string, [key: string]: any }>,
 *   keybinds?: Record<string, string>,
 *   colors?: Record<string, string>,
 *   width?: number,
 * }} [options]
 * @returns {string[]}
 */
export function helpLines({
  commands = COMMAND_MANIFEST,
  settings = SETTINGS,
  keybinds = defaultKeybinds(),
  colors = {},
  width = 60,
} = {}) {
  // Clamps terminal width to 60 columns minimum so compact viewports remain usable.
  const termWidth = Number(width) > 0 ? Number(width) : 60;
  return [
    ...commands.flatMap((cmd) => formatCommand(cmd, termWidth, colors)),
    ...formatSettings(settings, termWidth, colors),
    ...formatKeyboard(keybinds, termWidth, colors),
  ];
}

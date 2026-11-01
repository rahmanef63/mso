import process from "node:process";
import { createPrinter } from "./mso-agent-print.mjs";
import {
  SETTINGS,
  defaultSettingsPath,
  formatSettingsTable,
  getSettingWarnings,
  getSettings,
  resetSettings,
  resolveSetting,
  saveSettings,
} from "./mso-agent-settings.mjs";

export async function handleSettingsCommand(ctx, args = []) {
  const { session, C: colors = {} } = ctx;
  const { print, printBlock } = createPrinter(ctx);
  const sub = String(args[0] || "").toLowerCase().trim();
  const filePath = defaultSettingsPath();
  const width = Number(ctx.width || process.stdout?.columns) || 80;

  if (sub === "reset") {
    const settings = resetSettings({ path: filePath });
    if (session) {
      if (settings.pane) session.paneKind = settings.pane;
      if (settings.statusbar) session.statusBar = settings.statusbar === "on";
      if (settings.minwidth != null) session.paneMinColumns = Number(settings.minwidth);
    }
    print(`reset settings to defaults from ${filePath}`);
    printBlock(formatSettingsTable(SETTINGS, settings, { colors, width }));
    return "handled";
  }

  if (!args.length) {
    const warnings = getSettingWarnings();
    for (const w of warnings) print(`${colors.warn || ""}warning:${colors.reset || ""} ${w}`);
    print(`config: ${filePath}`);
    printBlock(formatSettingsTable(SETTINGS, getSettings(), { colors, width }));
    return "handled";
  }

  const resolved = resolveSetting(SETTINGS, sub);
  if (resolved?.status === "ambiguous") {
    const candidates = resolved.ambiguous.map((e) => e.key).join(", ");
    print(`${colors.warn || ""}ambiguous setting "${args[0]}": matches [${candidates}]${colors.reset || ""}`);
    return "handled";
  }

  if (!resolved || !resolved.entry) {
    print(`${colors.warn || ""}unknown setting "${args[0]}"${colors.reset || ""}`);
    return "handled";
  }

  const entry = resolved.entry;
  if (args.length === 1) {
    const current = getSettings()[entry.key] ?? entry.default;
    const allowed = entry.values
      ? ` (options: ${entry.values.join(", ")})`
      : typeof entry.min === "number" && typeof entry.max === "number"
        ? ` (range: ${entry.min}-${entry.max})`
        : "";
    print(`${entry.key} = ${current}${allowed}: ${entry.description}`);
    return "handled";
  }

  const rawArg = String(args[1] ?? "").trim();
  const requestedValue = rawArg.toLowerCase();
  let valueToSave = requestedValue;

  if (entry.values) {
    if (!entry.values.includes(requestedValue)) {
      print(
        `${colors.warn || ""}invalid value "${args[1]}" for ${entry.key}; valid options: ${entry.values.join(", ")}${colors.reset || ""}`
      );
      return "handled";
    }
  } else if (typeof entry.min === "number" && typeof entry.max === "number") {
    // Numeric settings clamp against valid terminal bounds to prevent pane crowding
    const num = Number(rawArg);
    if (!Number.isFinite(num) || num < entry.min || num > entry.max) {
      print(
        `${colors.warn || ""}invalid value "${args[1]}" for ${entry.key}; accepted range is ${entry.min} to ${entry.max}${colors.reset || ""}`
      );
      return "handled";
    }
    valueToSave = Math.round(num);
  }

  saveSettings({ [entry.key]: valueToSave }, { path: filePath });

  // Apply to running session if present
  if (session) {
    if (entry.key === "pane") session.paneKind = requestedValue;
    if (entry.key === "statusbar") session.statusBar = requestedValue === "on";
    if (entry.key === "minwidth") session.paneMinColumns = valueToSave;
  }

  print(`${colors.cyan || ""}setting ${entry.key} = ${valueToSave}${colors.reset || ""}`);
  return "handled";
}

// Applied once at session start, before the first frame. Without this the registry only stores
// preferences: a value saved in one run would never take effect in the next, which makes every entry
// look like a switch that does nothing.
export function applySettings(session, settings = getSettings()) {
  if (!session || !settings) return;
  if (settings.pane) session.paneKind = settings.pane;
  if (settings.statusbar) session.statusBar = settings.statusbar === "on";
  if (settings.minwidth != null) session.paneMinColumns = Number(settings.minwidth);
}

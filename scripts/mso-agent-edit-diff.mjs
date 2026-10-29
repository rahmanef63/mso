import { colorizeDiffLine, diffLineCap } from "./mso-agent-diff.mjs";

/**
 * Parse fs_edit result JSON string or object.
 * Returns the parsed object if valid and contains a diff string, else null.
 * Never throws.
 */
export function parseEditResult(result) {
  if (result == null) return null;
  let parsed = result;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  if (typeof parsed.diff !== "string") {
    return null;
  }
  return parsed;
}

export const parseEditDiff = parseEditResult;

function colorizeLine(line, colors = {}) {
  if (!colors) return line;
  const colored = colorizeDiffLine(line, colors);
  if (colored === line && colors.dim) {
    return `${colors.dim}${line}${colors.reset || ""}`;
  }
  return colored;
}

/**
 * @typedef {Object} EditDiffPalette
 * @property {string} [dim]
 * @property {string} [reset]
 * @property {string} [c]
 * @property {string} [cyan]
 * @property {string} [err]
 * @property {string} [blue]
 */

/**
 * @typedef {Object} FormatEditDiffOptions
 * @property {EditDiffPalette} [colors]
 * @property {number} [cap]
 */

/**
 * Format the diff returned by fs_edit into an indented, colored block.
 * Returns empty string when diff is empty or invalid.
 * @param {any} parsed
 * @param {FormatEditDiffOptions} [options]
 * @returns {string}
 */
export function formatEditDiff(parsed, { colors = {}, cap } = {}) {
  if (!parsed || typeof parsed.diff !== "string") return "";
  const raw = parsed.diff.replace(/\r/g, "");
  const trimmed = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  const diffLines = trimmed ? trimmed.split("\n") : [];
  if (!diffLines.length || (diffLines.length === 1 && !diffLines[0])) return "";

  const effectiveCap = Number.isInteger(cap) ? cap : diffLineCap();
  const isTruncated = diffLines.length > effectiveCap;
  const targetLines = isTruncated ? diffLines.slice(0, effectiveCap) : diffLines;

  const rawPath = typeof parsed.path === "string" ? parsed.path.trim() : "";
  const baseName = (rawPath ? rawPath.split(/[/\\]/).filter(Boolean).pop() : null) || "file";

  const label = parsed.written === false
    ? `edit ${baseName} (preview, not written)`
    : `edit ${baseName}`;

  const indent = "  ";
  const lines = [
    `${indent}${label}`,
    ...targetLines.map((line) => `${indent}${colorizeLine(line, colors)}`),
  ];

  if (isTruncated) {
    const withheld = diffLines.length - effectiveCap;
    const withheldText = `… ${withheld} more lines`;
    const dimmed = colors?.dim ? `${colors.dim}${withheldText}${colors.reset || ""}` : withheldText;
    lines.push(`${indent}${dimmed}`);
  }

  if (parsed.diffTruncated) {
    const cutText = "… diff truncated by server";
    const dimmed = colors?.dim ? `${colors.dim}${cutText}${colors.reset || ""}` : cutText;
    lines.push(`${indent}${dimmed}`);
  }

  return lines.join("\n");
}

/**
 * @typedef {Object} PrintEditDiffOptions
 * @property {EditDiffPalette} [colors]
 * @property {number} [cap]
 * @property {(text: string) => void} [print]
 * @property {{ live?: boolean, clear?: () => void }} [activity]
 */

/**
 * Write the formatted edit diff through print (default console.log).
 * Returns true if something was printed, false otherwise.
 * @param {any} parsed
 * @param {PrintEditDiffOptions} [options]
 * @returns {boolean}
 */
export function printEditDiff(parsed, { colors, cap, print = console.log, activity } = {}) {
  const formatted = formatEditDiff(parsed, { colors, cap });
  if (!formatted) return false;
  if (activity?.live) {
    activity.clear();
    const tone = colors?.c || colors?.cyan || "";
    const reset = colors?.reset || "";
    print(`${tone}  ✓ fs_edit${reset}`);
  }
  print(formatted);
  return true;
}

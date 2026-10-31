import os from "node:os";
import path from "node:path";
import process from "node:process";
import { api } from "./mso-agent-api.mjs";
import { C, fit } from "./mso-agent-ui.mjs";
import { AgentApiError, safeErrorSummary } from "./mso-agent-errors.mjs";
import { sectionDivider } from "./mso-agent-layout.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

// Terminal height minus header, divider, and prompt margin, clamped [5, 60].
export function computeRows(terminalRows = 24) {
  const r = Number(terminalRows) || 24;
  return Math.max(5, Math.min(60, r - 8));
}

// User-supplied paths may start with ~; expand without spawning a shell.
export function expandPath(inputPath, cwd = process.cwd()) {
  const raw = String(inputPath ?? "").trim();
  if (!raw) return cwd;
  const home = os.homedir();
  if (raw === "~") return home;
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.resolve(home, raw.slice(2));
  }
  return path.resolve(cwd, raw);
}

// Target GET /api/v1/fs/list with URI-encoded target path.
export function buildFilesUrl(inputPath, cwd = process.cwd()) {
  const resolved = expandPath(inputPath, cwd);
  return `/api/v1/fs/list?path=${encodeURIComponent(resolved)}`;
}

export function isDirectory(entry) {
  if (!entry || typeof entry !== "object") return false;
  const kind = String(entry.kind || entry.type || "").toLowerCase();
  if (kind === "dir" || kind === "directory") return true;
  return String(entry.name || "").endsWith("/");
}

export function isSymlink(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.isSymbolicLink === true || entry.isSymlink === true) return true;
  const kind = String(entry.kind || "").toLowerCase();
  const type = String(entry.type || "").toLowerCase();
  return kind === "symlink" || kind === "link" || type === "symlink" || type === "link";
}

// Surface unusual inode types explicitly without relying on sizes.
export function entryTypeTag(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (isSymlink(entry)) return "(symlink)";
  const type = String(entry.type || entry.kind || "").toLowerCase();
  if (!type || type === "file" || type === "dir" || type === "directory") return "";
  return `(${type})`;
}

// Format a bounded tree view without leaking 0-byte fake sizes.
export function formatEntries(entries, { columns = 80, rows = 60, path = "", colors = {} } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const limit = Math.max(5, Math.min(60, Number(rows ?? 60) || 60));

  const sorted = [...list].sort((a, b) => {
    const aDir = isDirectory(a);
    const bDir = isDirectory(b);
    if (aDir !== bDir) return aDir ? -1 : 1;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });

  const isCapped = sorted.length > limit;
  const visible = isCapped ? sorted.slice(0, limit) : sorted;
  const remaining = sorted.length - visible.length;

  const capText = `capped at ${limit}`;
  const headerDetail = isCapped
    ? (path ? `${path} (${capText})` : capText)
    : (path || "");

  const lines = [sectionDivider("files", { columns, detail: headerDetail, colors })];

  if (list.length === 0) {
    lines.push("  (empty directory)");
    return lines;
  }

  const colWidth = 32;
  for (const entry of visible) {
    const isDir = isDirectory(entry);
    const name = isDir
      ? (String(entry.name || "").endsWith("/") ? entry.name : `${entry.name}/`)
      : String(entry.name || "");
    const tag = entryTypeTag(entry);
    let entryText = "";
    if (tag) {
      entryText = name.length < colWidth
        ? `  ${name.padEnd(colWidth)}  ${tag}`
        : `  ${name}  ${tag}`;
    } else {
      entryText = `  ${name}`;
    }

    if (columns > 0 && entryText.length > columns) {
      entryText = fit(entryText, columns);
    }

    if (colors && (colors.blue || colors.bold || colors.dim || colors.cyan || colors.c)) {
      if (isDir) {
        entryText = `${colors.bold || ""}${colors.blue || ""}${entryText}${colors.reset || ""}`;
      } else if (isSymlink(entry)) {
        entryText = `${colors.cyan || colors.c || ""}${entryText}${colors.reset || ""}`;
      }
    }

    lines.push(entryText);
  }

  if (isCapped) {
    const moreText = `  … ${remaining} more`;
    lines.push(colors?.dim ? `${colors.dim}${moreText}${colors.reset || ""}` : moreText);
  }

  return lines;
}

// Bounded read-only view of target or working directory.
export async function handleFilesCommand(args = [], session = null, options = {}) {
  const callApi = options.apiFn || api;
  const print = options.print || createPrinter({ session, colors: C }).printBlock;
  const printErr = options.printErr || console.error;
  const rawTarget = args.join(" ").trim();
  const targetPath = expandPath(rawTarget);
  const url = buildFilesUrl(rawTarget);

  let data;
  try {
    data = await callApi(url);
  } catch (error) {
    // Keep TUI interactive when requested path is outside roots or missing.
    const msg = error instanceof AgentApiError ? error.message : safeErrorSummary(error);
    printErr(`${C.err}${msg}${C.reset}`);
    return;
  }

  if (data?.error) {
    printErr(`${C.err}${data.error}${C.reset}`);
    return;
  }

  const columns = options.columns ?? process.stdout?.columns ?? 80;
  const terminalRows = options.rows ?? process.stdout?.rows ?? 24;
  const rows = computeRows(terminalRows);
  const lines = formatEntries(data?.entries || [], {
    columns,
    rows,
    path: data?.path || targetPath,
    colors: C,
  });

  print(lines.join("\n"));
}

#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import readline from "node:readline";
import tty from "node:tty";

const CLEAR = "\x1b[2K";
const UP = (n) => n > 0 ? `\x1b[${n}A` : "";
const DOWN = (n) => n > 0 ? `\x1b[${n}B` : "";
const DIM = process.env.NO_COLOR ? "" : "\x1b[2m";
const BOLD = process.env.NO_COLOR ? "" : "\x1b[1m";
const BLUE = process.env.NO_COLOR ? "" : "\x1b[38;2;69;142;255m";
const GREEN = process.env.NO_COLOR ? "" : "\x1b[38;2;46;229;157m";
const RESET = process.env.NO_COLOR ? "" : "\x1b[0m";

const clean = (value) => String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
const visibleWidth = (value) => Array.from(String(value ?? "").replace(/\x1b\[[0-9;]*m/g, "")).length;
const fit = (value, max) => {
  const chars = Array.from(clean(value));
  if (chars.length <= max) return chars.join("");
  return max <= 1 ? "…".slice(0, max) : `${chars.slice(0, max - 1).join("")}…`;
};
const pad = (value, max) => {
  const out = fit(value, max);
  return out + " ".repeat(Math.max(0, max - visibleWidth(out)));
};

export function parsePickerItems(raw) {
  return String(raw || "").split(/\r?\n/).filter(Boolean).map((line) => {
    const [value = "", label = "", meta = "", state = ""] = line.split("\t");
    return { value, label: label || value, meta, state };
  }).filter((item) => item.value);
}

export function filterPickerItems(items, query) {
  const q = clean(query).toLowerCase();
  if (!q) return items.slice();
  return items.filter((item) => `${item.label} ${item.value} ${item.meta}`.toLowerCase().includes(q));
}

export function pickerWindow(items, selected, size = 9) {
  if (!items.length) return { start: 0, rows: [] };
  const count = Math.min(Math.max(1, size), items.length);
  const idx = Math.min(Math.max(0, selected), items.length - 1);
  const start = Math.max(0, Math.min(idx - Math.floor(count / 2), items.length - count));
  return { start, rows: items.slice(start, start + count) };
}

export function nextPickerIndex(length, selected, direction) {
  if (!length) return 0;
  return (selected + direction + length) % length;
}

function panel(items, selected, title, query, columns) {
  const width = Math.max(48, Math.min(96, Number(columns || 96) - 2));
  const { start, rows } = pickerWindow(items, selected, 9);
  const titleText = ` ${title} `;
  const top = `╭─${titleText}${"─".repeat(Math.max(0, width - visibleWidth(titleText) - 3))}╮`;
  const search = query ? `filter: ${query}` : "type to filter";
  const lines = [`${BLUE}${top}${RESET}`, `│ ${DIM}${pad(search, width - 4)}${RESET} │`];
  if (!rows.length) lines.push(`│ ${DIM}${pad("No matches", width - 4)}${RESET} │`);
  for (let offset = 0; offset < rows.length; offset++) {
    const item = rows[offset];
    const active = start + offset === selected;
    const current = item.state === "current";
    const marker = active ? `${BLUE}${BOLD}›${RESET}` : " ";
    const currentMark = current ? `${GREEN}●${RESET}` : " ";
    const prefixWidth = 5;
    const labelWidth = Math.max(14, Math.min(38, Math.floor((width - prefixWidth) * 0.48)));
    const metaWidth = Math.max(0, width - prefixWidth - labelWidth - 4);
    const label = active ? `${BLUE}${BOLD}${pad(item.label, labelWidth)}${RESET}` : pad(item.label, labelWidth);
    const meta = metaWidth ? `${DIM}${pad(item.meta, metaWidth)}${RESET}` : "";
    lines.push(`│ ${marker} ${currentMark} ${label}${meta ? ` ${meta}` : ""} │`);
  }
  const hint = " ↑↓ navigate · type filter · Enter select · Esc cancel ";
  lines.push(`${BLUE}╰─${fit(hint, width - 3)}${"─".repeat(Math.max(0, width - visibleWidth(fit(hint, width - 3)) - 3))}╯${RESET}`);
  return lines;
}

async function run() {
  const title = clean(process.argv[2] || "Select");
  const activeValue = String(process.argv[3] || "");
  const items = parsePickerItems(fs.readFileSync(0, "utf8"));
  if (!items.length) process.exit(2);

  // One read/write descriptor: no separate pathname check/open or truncating open.
  const terminalFd = fs.openSync("/dev/tty", fs.constants.O_RDWR);
  const input = new tty.ReadStream(terminalFd);
  const output = new tty.WriteStream(terminalFd);
  readline.emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  let query = "";
  let visible = items.slice();
  let selected = Math.max(0, visible.findIndex((item) => item.value === activeValue));
  let reserved = 0;

  const reserve = (rows) => {
    if (rows <= reserved) return;
    if (reserved) output.write(DOWN(reserved));
    for (let i = reserved; i < rows; i++) output.write("\r\n");
    output.write(`${UP(rows)}\r`);
    reserved = rows;
  };
  const erase = () => {
    output.write(`\r${CLEAR}`);
    for (let i = 0; i < reserved; i++) output.write(`${DOWN(1)}\r${CLEAR}`);
    if (reserved) output.write(`${UP(reserved)}\r`);
  };
  const render = () => {
    const lines = panel(visible, selected, title, query, output.columns);
    reserve(lines.length - 1);
    erase();
    output.write(lines[0]);
    for (const line of lines.slice(1)) output.write(`${DOWN(1)}\r${CLEAR}${line}`);
    if (lines.length > 1) output.write(UP(lines.length - 1));
    output.write("\r");
  };
  const cleanup = () => {
    input.off("keypress", onKey);
    if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
    input.pause();
    erase();
  };
  const refilter = () => {
    visible = filterPickerItems(items, query);
    const activeIndex = visible.findIndex((item) => item.value === activeValue);
    selected = activeIndex >= 0 ? activeIndex : 0;
    render();
  };
  const finish = (code, value = "") => {
    cleanup();
    if (value) process.stdout.write(value);
    process.exit(code);
  };
  const onKey = (str, key = {}) => {
    if (key.ctrl && key.name === "c") return finish(130);
    if (key.name === "escape") return finish(130);
    if (key.name === "up") { selected = nextPickerIndex(visible.length, selected, -1); return render(); }
    if (key.name === "down") { selected = nextPickerIndex(visible.length, selected, 1); return render(); }
    if (key.name === "home") { selected = 0; return render(); }
    if (key.name === "end") { selected = Math.max(0, visible.length - 1); return render(); }
    if (key.name === "return" || key.name === "enter") {
      return visible[selected] ? finish(0, visible[selected].value) : undefined;
    }
    if (key.name === "backspace") { query = Array.from(query).slice(0, -1).join(""); return refilter(); }
    if (key.ctrl && key.name === "u") { query = ""; return refilter(); }
    if (str && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/u.test(str)) { query += str; return refilter(); }
  };

  input.on("keypress", onKey);
  input.resume();
  if (typeof input.setRawMode === "function") input.setRawMode(true);
  render();
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  run().catch((error) => {
    process.stderr.write(`mso picker: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
}

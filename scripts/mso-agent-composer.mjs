import readline from "node:readline";
import process from "node:process";

const CLEAR_LINE = "\x1b[2K";
const CURSOR_UP = (n) => n > 0 ? `\x1b[${n}A` : "";
const CURSOR_DOWN = (n) => n > 0 ? `\x1b[${n}B` : "";
const CURSOR_RIGHT = (n) => n > 0 ? `\x1b[${n}C` : "";
const plain = (value) => String(value ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const chars = (value) => Array.from(String(value ?? ""));
const width = (value) => chars(plain(value)).length;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function fit(value, max) {
  const row = chars(plain(value).replace(/[\r\n\t]+/g, " "));
  if (row.length <= max) return row.join("");
  return max <= 1 ? "…".slice(0, max) : row.slice(0, max - 1).join("") + "…";
}

function pad(value, max) {
  const clean = fit(value, max);
  return clean + " ".repeat(Math.max(0, max - width(clean)));
}

export function inputViewport(value, cursor, maxWidth) {
  const row = chars(value);
  const max = Math.max(1, maxWidth);
  if (row.length <= max) return { display: row.join(""), cursor: clamp(cursor, 0, row.length) };
  const interior = Math.max(1, max - 2);
  let start = clamp(cursor - Math.floor(interior * 0.7), 0, Math.max(0, row.length - interior));
  let end = Math.min(row.length, start + interior);
  if (cursor > end) { end = cursor; start = Math.max(0, end - interior); }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < row.length ? "…" : "";
  return {
    display: `${prefix}${row.slice(start, end).join("")}${suffix}`,
    cursor: width(prefix) + clamp(cursor - start, 0, end - start),
  };
}

export function completionWindow(items, selected, size = 8) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return { start: 0, items: [] };
  const count = Math.min(Math.max(1, size), rows.length);
  const idx = clamp(selected, 0, rows.length - 1);
  const start = Math.max(0, Math.min(idx - Math.floor(count / 2), rows.length - count));
  return { start, items: rows.slice(start, start + count) };
}

function menuLines(items, selected, columns, C) {
  const { start, items: visible } = completionWindow(items, selected, 8);
  if (!visible.length) return [];
  const panelWidth = Math.max(38, Math.min(100, Number(columns || 100) - 2));
  const label = " commands & skills ";
  const top = `╭─${label}${"─".repeat(Math.max(0, panelWidth - width(label) - 3))}╮`;
  const nameWidth = Math.min(32, Math.max(12, ...visible.map((item) => width(item.text) + 1)));
  const metaWidth = Math.max(0, panelWidth - nameWidth - 7);
  const body = visible.map((item, offset) => {
    const active = start + offset === selected;
    const marker = active ? `${C.blue}${C.bold}›${C.reset}` : " ";
    const name = active ? `${C.blue}${C.bold}${pad(item.text, nameWidth)}${C.reset}` : pad(item.text, nameWidth);
    const meta = metaWidth ? `${C.dim}${fit(item.meta || "", metaWidth)}${C.reset}` : "";
    return `│ ${marker} ${name}${meta ? ` ${meta}` : ""}${" ".repeat(Math.max(0, metaWidth - width(fit(item.meta || "", metaWidth))))} │`;
  });
  const hint = " ↑↓ navigate · Enter/Tab select · Esc close ";
  const bottom = `╰─${fit(hint, panelWidth - 3)}${"─".repeat(Math.max(0, panelWidth - width(fit(hint, panelWidth - 3)) - 3))}╯`;
  return [`${C.blue}${top}${C.reset}`, ...body, `${C.blue}${bottom}${C.reset}`];
}

export class AgentComposer {
  constructor({ input = process.stdin, output = process.stdout, colors }) {
    this.input = input;
    this.output = output;
    this.C = colors;
    this.history = [];
    this.closed = false;
    readline.emitKeypressEvents(this.input);
  }

  async question(prompt, { complete = null, history = true } = {}) {
    if (this.closed) return null;
    const input = this.input, output = this.output, C = this.C;
    return new Promise((resolve) => {
      let value = "", cursor = 0, selected = 0, reservedMenuRows = 0;
      let dismissed = false, historyIndex = null, draft = "";
      const wasRaw = Boolean(input.isRaw);

      const matches = () => dismissed || !complete ? [] : complete(value) || [];
      // Reserve physical rows only when the dropdown first grows. Selection changes then
      // redraw with cursor movement only — no LF/CRLF — so ↑/↓ never create scrollback rows.
      const reserve = (rows) => {
        if (rows <= reservedMenuRows) return;
        if (reservedMenuRows) output.write(CURSOR_DOWN(reservedMenuRows));
        for (let i = reservedMenuRows; i < rows; i++) output.write("\r\n");
        output.write(`${CURSOR_UP(rows)}\r`);
        reservedMenuRows = rows;
      };
      const erase = () => {
        output.write(`\r${CLEAR_LINE}`);
        for (let i = 0; i < reservedMenuRows; i++) output.write(`${CURSOR_DOWN(1)}\r${CLEAR_LINE}`);
        if (reservedMenuRows) output.write(`${CURSOR_UP(reservedMenuRows)}\r`);
      };
      const render = () => {
        const maxInput = Math.max(8, Number(output.columns || 100) - width(prompt) - 2);
        const viewport = inputViewport(value, cursor, maxInput);
        const items = matches();
        selected = items.length ? clamp(selected, 0, items.length - 1) : 0;
        const menu = menuLines(items, selected, output.columns, C);
        reserve(menu.length);
        erase();
        output.write(`${prompt}${viewport.display}`);
        for (const row of menu) output.write(`${CURSOR_DOWN(1)}\r${CLEAR_LINE}${row}`);
        if (menu.length) output.write(CURSOR_UP(menu.length));
        output.write(`\r${CURSOR_RIGHT(width(prompt) + viewport.cursor)}`);
      };
      const cleanup = () => {
        input.off("keypress", onKey);
        if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
        input.pause();
      };
      const finish = (result, echo = true) => {
        erase();
        if (echo) output.write(`${prompt}${value}\r\n`);
        cleanup();
        if (history && result?.trim()) {
          this.history.unshift(result);
          if (this.history.length > 100) this.history.length = 100;
        }
        resolve(result);
      };
      const edit = (next, nextCursor) => {
        value = next; cursor = clamp(nextCursor, 0, chars(value).length);
        selected = 0; dismissed = false; historyIndex = null;
        render();
      };
      const apply = (item) => {
        if (!item?.text) return;
        value = item.text; cursor = chars(value).length; dismissed = true; selected = 0;
        render();
      };
      const historyMove = (dir) => {
        if (!history || !this.history.length) return;
        if (historyIndex === null) { draft = value; historyIndex = dir < 0 ? 0 : null; }
        else historyIndex = dir < 0 ? Math.min(this.history.length - 1, historyIndex + 1) : historyIndex - 1;
        if (historyIndex === null || historyIndex < 0) { historyIndex = null; value = draft; }
        else value = this.history[historyIndex] || "";
        cursor = chars(value).length; dismissed = true; render();
      };
      const onKey = (str, key = {}) => {
        const items = matches();
        if (key.ctrl && key.name === "d" && !value) return finish(null, false);
        if (key.ctrl && key.name === "c") {
          if (value) return edit("", 0);
          erase(); output.write("^C\r\n"); cleanup(); return resolve("");
        }
        if (key.name === "escape") { dismissed = true; selected = 0; return render(); }
        if (items.length && (key.name === "up" || key.name === "down")) {
          selected = (selected + (key.name === "up" ? -1 : 1) + items.length) % items.length;
          return render();
        }
        if (key.name === "tab" && items.length) return apply(items[selected]);
        if (key.name === "return" || key.name === "enter") {
          // Exact input wins even when another prefix match is highlighted first
          // (`/model` vs `/models`). Enter submits what the user actually typed;
          // Tab is the explicit "apply highlighted completion" key.
          if (items.some((item) => item?.text === value)) return finish(value);
          if (items.length && items[selected]?.text) return apply(items[selected]);
          return finish(value);
        }
        if (key.name === "up" && !items.length) return historyMove(-1);
        if (key.name === "down" && !items.length) return historyMove(1);
        const row = chars(value);
        if (key.name === "left") { cursor = Math.max(0, cursor - 1); return render(); }
        if (key.name === "right") { cursor = Math.min(row.length, cursor + 1); return render(); }
        if (key.name === "home" || (key.ctrl && key.name === "a")) { cursor = 0; return render(); }
        if (key.name === "end" || (key.ctrl && key.name === "e")) { cursor = row.length; return render(); }
        if (key.name === "backspace" && cursor > 0) return edit([...row.slice(0, cursor - 1), ...row.slice(cursor)].join(""), cursor - 1);
        if (key.name === "delete" && cursor < row.length) return edit([...row.slice(0, cursor), ...row.slice(cursor + 1)].join(""), cursor);
        if (key.ctrl && key.name === "u") return edit(row.slice(cursor).join(""), 0);
        if (key.ctrl && key.name === "k") return edit(row.slice(0, cursor).join(""), cursor);
        if (str && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/u.test(str)) {
          const insert = chars(str);
          return edit([...row.slice(0, cursor), ...insert, ...row.slice(cursor)].join(""), cursor + insert.length);
        }
      };

      input.on("keypress", onKey);
      input.resume();
      if (typeof input.setRawMode === "function") input.setRawMode(true);
      render();
    });
  }

  close() {
    this.closed = true;
    if (typeof this.input.setRawMode === "function" && this.input.isRaw) this.input.setRawMode(false);
    this.input.pause();
  }
}

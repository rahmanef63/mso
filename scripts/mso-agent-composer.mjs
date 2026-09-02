import readline from "node:readline";
import { wordLeftIndex, wordRightIndex } from "./mso-agent-editing.mjs";
import process from "node:process";

import {
  chars, clamp, CLEAR_LINE, CLEAR_SCREEN, completionWindow, CURSOR_DOWN, CURSOR_RIGHT, CURSOR_UP, inputViewport, menuLines, width,
} from "./mso-agent-composer-ui.mjs";
export { completionWindow, inputViewport } from "./mso-agent-composer-ui.mjs";

export class AgentComposer {
  constructor({ input = process.stdin, output = process.stdout, colors }) {
    this.input = input;
    this.output = output;
    this.C = colors;
    this.history = [];
    this.closed = false;
    this._cancelCurrent = null;
    readline.emitKeypressEvents(this.input);
  }

  async question(prompt, { complete = null, history = true, onCancel = null, onTab = null, panelLabel = "commands & skills", selectOnEnter = false, escapeCancels = false } = {}) {
    if (this.closed) return null;
    const input = this.input, output = this.output, C = this.C;
    return new Promise((resolve) => {
      let value = "", cursor = 0, selected = 0, reservedMenuRows = 0;
      let dismissed = false, historyIndex = null, draft = "", settled = false;
      const promptText = () => String(typeof prompt === "function" ? prompt() : prompt);
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
        const currentPrompt = promptText();
        const maxInput = Math.max(8, Number(output.columns || 100) - width(currentPrompt) - 2);
        const viewport = inputViewport(value, cursor, maxInput);
        const items = matches();
        selected = items.length ? clamp(selected, 0, items.length - 1) : 0;
        const menu = menuLines(items, selected, output.columns, C, panelLabel);
        reserve(menu.length);
        erase();
        output.write(`${currentPrompt}${viewport.display}`);
        for (const row of menu) output.write(`${CURSOR_DOWN(1)}\r${CLEAR_LINE}${row}`);
        if (menu.length) output.write(CURSOR_UP(menu.length));
        output.write(`\r${CURSOR_RIGHT(width(currentPrompt) + viewport.cursor)}`);
      };
      const cleanup = () => {
        input.off("keypress", onKey);
        if (this._cancelCurrent === cancel) this._cancelCurrent = null;
        if (typeof input.setRawMode === "function") input.setRawMode(wasRaw);
        input.pause();
      };
      const finish = (result, echo = true, displayValue = value) => {
        if (settled) return;
        settled = true;
        erase();
        if (echo) output.write(`${promptText()}${displayValue}\r\n`);
        cleanup();
        if (history && result?.trim()) {
          this.history.unshift(result);
          if (this.history.length > 100) this.history.length = 100;
        }
        resolve(result);
      };
      const cancel = (echo = true) => {
        if (settled) return false;
        if (typeof onCancel === "function") onCancel();
        settled = true;
        erase();
        if (echo) output.write("^C\r\n");
        cleanup();
        resolve(null);
        return true;
      };
      this._cancelCurrent = cancel;
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
        if (key.ctrl && key.name === "c") {
          if (value) return edit("", 0);
          return cancel(true);
        }
        if (key.ctrl && key.name === "l") {
          output.write(CLEAR_SCREEN); reservedMenuRows = 0; return render();
        }
        if (key.name === "escape") {
          if (escapeCancels) return cancel(false);
          dismissed = true; selected = 0; return render();
        }
        if (items.length && (key.name === "up" || key.name === "down")) {
          selected = (selected + (key.name === "up" ? -1 : 1) + items.length) % items.length;
          return render();
        }
        if (key.name === "tab" && items.length) {
          if (selectOnEnter) {
            const item = items[selected];
            return finish(item.value ?? item.text, true, item.label || item.text);
          }
          return apply(items[selected]);
        }
        if (key.name === "tab" && !value && typeof onTab === "function") {
          onTab();
          dismissed = false; selected = 0;
          return render();
        }
        if (key.name === "return" || key.name === "enter") {
          if (selectOnEnter && items[selected]) {
            const item = items[selected];
            return finish(item.value ?? item.text, true, item.label || item.text);
          }
          // Exact input wins even when another prefix match is highlighted first
          // (`/model` vs `/models`). Enter submits what the user actually typed;
          // Tab is the explicit "apply highlighted completion" key.
          if (items.some((item) => item?.text === value)) return finish(value);
          if (items.length && items[selected]?.text) return apply(items[selected]);
          return finish(value);
        }
        if ((key.name === "up" && !items.length) || (key.ctrl && key.name === "p")) return historyMove(-1);
        if ((key.name === "down" && !items.length) || (key.ctrl && key.name === "n")) return historyMove(1);
        const row = chars(value);
        if (key.ctrl && key.name === "d") {
          if (!value) return finish(null, false);
          if (cursor < row.length) return edit([...row.slice(0, cursor), ...row.slice(cursor + 1)].join(""), cursor);
          return render();
        }
        if (((key.ctrl || key.meta) && key.name === "left") || (key.meta && key.name === "b")) { cursor = wordLeftIndex(value, cursor); return render(); }
        if (((key.ctrl || key.meta) && key.name === "right") || (key.meta && key.name === "f")) { cursor = wordRightIndex(value, cursor); return render(); }
        if (key.name === "left" || (key.ctrl && key.name === "b")) { cursor = Math.max(0, cursor - 1); return render(); }
        if (key.name === "right" || (key.ctrl && key.name === "f")) { cursor = Math.min(row.length, cursor + 1); return render(); }
        if (key.name === "home" || (key.ctrl && key.name === "a")) { cursor = 0; return render(); }
        if (key.name === "end" || (key.ctrl && key.name === "e")) { cursor = row.length; return render(); }
        if (key.name === "backspace" && cursor > 0) return edit([...row.slice(0, cursor - 1), ...row.slice(cursor)].join(""), cursor - 1);
        if (key.name === "delete" && cursor < row.length) return edit([...row.slice(0, cursor), ...row.slice(cursor + 1)].join(""), cursor);
        if (key.ctrl && key.name === "w") {
          const start = wordLeftIndex(value, cursor);
          return edit([...row.slice(0, start), ...row.slice(cursor)].join(""), start);
        }
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

  replaceHistory(values) {
    this.history = (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? "").replace(/[\r\n\t]+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 100);
  }

  cancelCurrent({ echo = true } = {}) {
    return typeof this._cancelCurrent === "function" ? this._cancelCurrent(echo) : false;
  }

  close() {
    this.closed = true;
    if (typeof this.input.setRawMode === "function" && this.input.isRaw) this.input.setRawMode(false);
    this.input.pause();
  }
}

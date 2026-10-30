import readline from "node:readline";
import { wordLeftIndex, wordRightIndex } from "./mso-agent-editing.mjs";
import process from "node:process";
import { resumeActiveActivity, suspendActiveActivity } from "./mso-agent-activity.mjs";
import { getKeybinds, resolveKeybind } from "./mso-agent-keybinds.mjs";

import {
  chars, clamp, CLEAR_LINE, CLEAR_SCREEN, completionWindow, CURSOR_DOWN, CURSOR_RIGHT, CURSOR_UP, eraseComposerRows, inputLayout, inputViewport, menuLines, reserveComposerRows, verticalCursor, width,
} from "./mso-agent-composer-ui.mjs";
export { completionWindow, inputLayout, inputViewport, verticalCursor } from "./mso-agent-composer-ui.mjs";

export class AgentComposer {
  constructor({ input = process.stdin, output = process.stdout, colors, keybinds = null, onToggleStatusBar = null }) {
    this.input = input; this.output = output; this.C = colors;
    this.keybinds = keybinds; this.onToggleStatusBar = onToggleStatusBar;
    this.history = []; this.closed = false; this._cancelCurrent = null; this._notifyCurrent = null;
    readline.emitKeypressEvents(this.input);
  }

  async question(prompt, { complete = null, history = true, onCancel = null, onTab = null, panelLabel = "commands & skills", selectOnEnter = false, escapeCancels = false, footer = null, separator = null, onToggleStatusBar = null } = {}) {
    if (this.closed) return null;
    const input = this.input, output = this.output, C = this.C;
    return new Promise((resolve) => {
      let value = "", cursor = 0, selected = 0, reservedRows = 0;
      let dismissed = false, historyIndex = null, draft = "", settled = false, verticalColumn = null;
      const promptText = () => String(typeof prompt === "function" ? prompt() : prompt);
      const footerText = () => String(typeof footer === "function" ? footer() : (footer || ""));
      const separatorText = () => String(typeof separator === "function" ? separator() : (separator || ""));
      const wasRaw = Boolean(input.isRaw);

      const matches = () => dismissed || !complete ? [] : complete(value) || [];
      // Reserve physical rows only when the dropdown first grows. Selection changes then
      // redraw with cursor movement only -- no LF/CRLF -- so ↑/↓ never create scrollback rows.
      const reserve = (rows) => { reservedRows = reserveComposerRows(output, reservedRows, rows); };
      const erase = () => eraseComposerRows(output, reservedRows);
      const render = () => {
        const currentPrompt = promptText();
        const promptWidth = width(currentPrompt);
        const items = matches();
        selected = items.length ? clamp(selected, 0, items.length - 1) : 0;
        const menu = menuLines(items, selected, output.columns, C, panelLabel);
        const footerRow = footerText();
        const footerRows = footerRow ? 1 : 0;
        const terminalRows = Math.max(8, Number(output.rows || 24));
        const maxInputRows = Math.max(2, Math.min(12, terminalRows - menu.length - footerRows - 4, Math.floor(terminalRows * 0.32)));
        const layout = inputLayout(value, cursor, { columns: output.columns, rows: terminalRows, promptWidth, maxRows: maxInputRows });
        const inputExtraRows = Math.max(0, layout.lines.length - 1);
        const below = inputExtraRows + menu.length + footerRows;
        reserve(below);
        erase();
        const continuation = " ".repeat(promptWidth);
        output.write(`${currentPrompt}${layout.lines[0] || ""}`);
        for (const row of layout.lines.slice(1)) output.write(`${CURSOR_DOWN(1)}\r${CLEAR_LINE}${continuation}${row}`);
        for (const row of menu) output.write(`${CURSOR_DOWN(1)}\r${CLEAR_LINE}${row}`);
        if (footerRow) output.write(`${CURSOR_DOWN(1)}\r${CLEAR_LINE}${footerRow}`);
        const backUp = menu.length + footerRows + (layout.lines.length - 1 - layout.cursorRow);
        if (backUp) output.write(CURSOR_UP(backUp));
        output.write(`\r${CURSOR_RIGHT(promptWidth + layout.cursorCol)}`);
      };
      const cleanup = () => {
        input.off("keypress", onKey);
        if (this._cancelCurrent === cancel) this._cancelCurrent = null;
        if (this._notifyCurrent === notify) this._notifyCurrent = null;
        if (typeof output.off === "function") output.off("resize", onResize);
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
      const notify = (text) => {
        if (settled) return false;
        // An in-flight turn may own a live activity row on this same row slot; clear
        // it so async traffic never lands inside the row, then repaint it after.
        suspendActiveActivity();
        erase();
        output.write(`${String(text ?? "").replace(/\r/g, "")}\r\n`);
        const separatorRow = separatorText();
        if (separatorRow) output.write(`${separatorRow}\r\n`);
        reservedRows = 0;
        render();
        resumeActiveActivity();
        return true;
      };
      this._cancelCurrent = cancel;
      this._notifyCurrent = notify;
      const edit = (next, nextCursor) => {
        value = next; cursor = clamp(nextCursor, 0, chars(value).length);
        selected = 0; dismissed = false; historyIndex = null; verticalColumn = null;
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
        cursor = chars(value).length; dismissed = true; verticalColumn = null; render();
      };
      const onResize = () => { if (!settled) render(); };
      const onKey = (str, key = {}) => {
        const items = matches();
        const action = resolveKeybind(key, this.keybinds || getKeybinds());
        if (action === "interrupt") return value ? edit("", 0) : cancel(true);
        if (action === "clear_screen") { output.write(CLEAR_SCREEN); reservedRows = 0; return render(); }
        if (action === "dismiss") {
          if (escapeCancels) return cancel(false);
          dismissed = true; selected = 0; return render();
        }
        if (action === "toggle_status_bar") {
          const toggle = onToggleStatusBar || this.onToggleStatusBar;
          if (typeof toggle === "function") toggle();
          return render();
        }
        if (items.length && (key.name === "up" || key.name === "down")) {
          selected = (selected + (key.name === "up" ? -1 : 1) + items.length) % items.length;
          return render();
        }
        // Tab is claimed only when there is something to complete, otherwise it falls through to
        // the editing path exactly as it did before keybinds existed.
        if (action === "complete" && (items.length || (!value && typeof onTab === "function"))) {
          if (items.length) return selectOnEnter ? finish(items[selected].value ?? items[selected].text, true, items[selected].label || items[selected].text) : apply(items[selected]);
          onTab(); dismissed = false; selected = 0; return render();
        }
        if (action === "submit") {
          if (selectOnEnter && items[selected]) return finish(items[selected].value ?? items[selected].text, true, items[selected].label || items[selected].text);
          if (items.some((item) => item?.text === value)) return finish(value);
          if (items.length && items[selected]?.text) return apply(items[selected]);
          return finish(value);
        }
        if (!items.length && (key.name === "up" || key.name === "down") && value) {
          const currentPrompt = promptText();
          const layout = inputLayout(value, cursor, { columns: output.columns, rows: output.rows, promptWidth: width(currentPrompt) });
          const moved = verticalCursor(value, cursor, layout.lineWidth, key.name === "up" ? -1 : 1, verticalColumn);
          if (moved.moved) { cursor = moved.cursor; verticalColumn = moved.column; return render(); }
        }
        if (action === "history_prev" || (key.name === "up" && !items.length)) return historyMove(-1);
        if (action === "history_next" || (key.name === "down" && !items.length)) return historyMove(1);
        const row = chars(value);
        if (key.ctrl && key.name === "d") {
          if (!value) return finish(null, false);
          if (cursor < row.length) return edit([...row.slice(0, cursor), ...row.slice(cursor + 1)].join(""), cursor);
          return render();
        }
        if (((key.ctrl || key.meta) && key.name === "left") || (key.meta && key.name === "b")) { cursor = wordLeftIndex(value, cursor); verticalColumn = null; return render(); }
        if (((key.ctrl || key.meta) && key.name === "right") || (key.meta && key.name === "f")) { cursor = wordRightIndex(value, cursor); verticalColumn = null; return render(); }
        if (key.name === "left" || (key.ctrl && key.name === "b")) { cursor = Math.max(0, cursor - 1); verticalColumn = null; return render(); }
        if (key.name === "right" || (key.ctrl && key.name === "f")) { cursor = Math.min(row.length, cursor + 1); verticalColumn = null; return render(); }
        if (key.name === "home" || (key.ctrl && key.name === "a")) { cursor = 0; verticalColumn = null; return render(); }
        if (key.name === "end" || (key.ctrl && key.name === "e")) { cursor = row.length; verticalColumn = null; return render(); }
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
      if (typeof output.on === "function") output.on("resize", onResize);
      input.resume();
      if (typeof input.setRawMode === "function") input.setRawMode(true);
      const separatorRow = separatorText();
      if (separatorRow) output.write(`${separatorRow}\r\n`);
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

  notify(text) {
    if (typeof this._notifyCurrent === "function") return this._notifyCurrent(text);
    this.output.write(`${String(text ?? "").replace(/\r/g, "")}\r\n`);
    return false;
  }

  close() {
    this.closed = true;
    if (typeof this.input.setRawMode === "function" && this.input.isRaw) this.input.setRawMode(false);
    this.input.pause();
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  MAX_OUTPUT_CHARS, appendTerminalSgrOutput, createTerminalController, sanitizeTerminalOutput,
  sanitizeTerminalSgr, type EventSourceLike, type TerminalState,
} from "../src/lib/terminal/term-controller.ts";
import { ansiColorCss, color256, highlightRuns, parseAnsiRuns, runsText, stripSgr } from "../src/lib/terminal/term-ansi.ts";
import { findMatches, matchLabel, stepMatch } from "../src/lib/terminal/term-search.ts";
import { addTab, closeTab, createTab, nextTabNumber, renameTab, sanitizeTitle, statusLabel, tabStatus, MAX_TABS, bindSession } from "../src/lib/terminal/term-tabs.ts";
import { emptyHistory, pushHistory, stepHistory, MAX_HISTORY } from "../src/lib/terminal/term-history.ts";
import { applyMods, pressWithMods, isPrintable } from "../src/lib/terminal/term-keybar.ts";
import { SNIPPETS, snippetCommand } from "../src/lib/terminal/term-snippets.ts";
import { gridEquals, measureGrid, MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS } from "../src/lib/terminal/term-metrics.ts";

const DIR = new URL("../src/lib/terminal/", import.meta.url);
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emitOpen() { this.readyState = 1; this.onopen?.(new Event("open")); }
  emitEvent(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent<string>);
  }
  close() { this.closed = true; this.readyState = 2; }
}

test("SGR parsing yields structured runs for 8/16 colours, bright, bold, dim, italic, underline and reset", () => {
  const runs = parseAnsiRuns("\x1b[31mred\x1b[0m \x1b[1mBold\x1b[22m \x1b[2mdim\x1b[0m \x1b[3mi\x1b[0m \x1b[4mu\x1b[0m \x1b[94mbright\x1b[0m \x1b[42mBg\x1b[49m");
  assert.deepEqual(runs.map((r) => r.text), ["red", " ", "Bold", " ", "dim", " ", "i", " ", "u", " ", "bright", " ", "Bg"]);
  assert.deepEqual(runs.map((r) => r.fg), ["red", null, null, null, null, null, null, null, null, null, "bright-blue", null, null]);
  assert.equal(runs[0].bg, null);
  assert.equal(runs[2].bold, true);
  assert.equal(runs[4].dim, true);
  assert.equal(runs[6].italic, true);
  assert.equal(runs[8].underline, true);
  assert.equal(runs[12].bg, "green");
  assert.equal(runsText(runs), "red Bold dim i u bright Bg");
});

test("SGR rendering never emits markup and drops unknown escapes", () => {
  const hostile = "\x1b[31m<img src=x onerror=alert(1)>\x1b[0m \x1b]0;title\x07ok";
  const runs = parseAnsiRuns(sanitizeTerminalSgr(hostile));
  assert.equal(runsText(runs), "<img src=x onerror=alert(1)> ok");
  assert.equal(runs[0].fg, "red");
  assert.equal(highlightRuns(runs, "<img").length >= 1, true);
  assert.equal(stripSgr("\x1b[1mhi\x1b[0m"), "hi");
});

test("SGR sanitizer keeps only SGR while the plain sanitizer removes all escapes", () => {
  const raw = "\x1b]0;user@host\x07\x1b[32mok\x1b[0m\x1b[2J\x1b[?25l\x07\x00";
  assert.equal(sanitizeTerminalOutput(raw), "ok");
  assert.equal(sanitizeTerminalSgr(raw), "\x1b[32mok\x1b[0m");
  const capped = appendTerminalSgrOutput("a".repeat(MAX_OUTPUT_CHARS - 4), "\x1b[31m12345678\x1b[0m");
  assert.equal(capped.length, MAX_OUTPUT_CHARS);
});

test("256-colour and truecolor map to safe CSS values", () => {
  assert.equal(color256(1), "red");
  assert.equal(color256(15), "bright-white");
  assert.equal(color256(196), "#ff0000");
  assert.equal(color256(232), "#080808");
  assert.equal(color256(999), null);
  assert.equal(ansiColorCss("red"), "var(--t-ansi-red)");
  assert.equal(ansiColorCss("#ff0000"), "#ff0000");
  assert.equal(ansiColorCss(null), undefined);
  const runs = parseAnsiRuns("\x1b[38;5;196mhot\x1b[48;2;0;128;255msea\x1b[39m");
  assert.equal(runs[0].fg, "#ff0000");
  assert.equal(runs[1].bg, "#0080ff");
  assert.equal(runs[1].fg, "#ff0000");
});

test("scrollback search finds matches, cycles with wraparound and highlights runs", () => {
  const text = "error: one\nwarning: two\nerror: three";
  const matches = findMatches(text, "ERROR");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((m) => m.start), [0, text.lastIndexOf("error")]);
  assert.equal(findMatches(text, "   ").length, 0);
  assert.equal(findMatches(text, "error", 1).length, 1);
  assert.equal(stepMatch(-1, 2, 1), 0);
  assert.equal(stepMatch(1, 2, 1), 0);
  assert.equal(stepMatch(0, 2, -1), 1);
  assert.equal(stepMatch(0, 0, 1), -1);
  assert.equal(matchLabel(0, 3), "1 of 3");
  assert.equal(matchLabel(-1, 0), "No matches");

  const runs = parseAnsiRuns("\x1b[31merror\x1b[0m: plain error");
  const marked = highlightRuns(runs, "error", 1);
  assert.equal(runsText(marked.map((r) => ({ ...r }))), "error: plain error");
  assert.deepEqual(marked.map((r) => r.hit), ["match", "none", "active"]);
  assert.equal(marked[0].fg, "red");
  assert.equal(highlightRuns(runs, "").every((r) => r.hit === "none"), true);
});

test("tab workspace adds, renames, closes and never drops to zero tabs", () => {
  let tabs = [createTab(1)];
  assert.equal(tabs[0].title, "Terminal");
  assert.equal(nextTabNumber(tabs), 2);
  const added = addTab(tabs, "/srv");
  assert.equal(added.activeId, 2);
  assert.equal(added.tabs[1].title, "Terminal 2");
  assert.equal(added.tabs[1].cwd, "/srv");

  let full = [createTab(1)];
  for (let i = 1; i < MAX_TABS; i++) full = addTab(full).tabs;
  assert.equal(full.length, MAX_TABS);
  assert.equal(addTab(full).activeId, null);
  assert.equal(addTab(full).tabs.length, MAX_TABS);

  const renamed = renameTab(added.tabs, 1, "  build   logs  ");
  assert.equal(renamed[0].title, "build logs");
  assert.equal(renameTab(added.tabs, 1, "   ")[0].title, "Terminal");
  assert.equal(sanitizeTitle("x".repeat(60), "fallback").length, 40);

  const closed = closeTab(added.tabs, 2, "/srv");
  assert.equal(closed.tabs.length, 1);
  assert.equal(closed.activeId, 1);
  const last = closeTab([createTab(1)], 1, "/srv");
  assert.equal(last.tabs.length, 1);
  assert.equal(last.tabs[0].id, 2);
  assert.equal(closeTab([createTab(1)], 99).activeId, null);
  assert.deepEqual(bindSession(added.tabs, 2, "pty-9").map((t) => t.sessionId), [null, "pty-9"]);

  assert.equal(tabStatus("connected"), "connected");
  assert.equal(tabStatus("connecting"), "connecting");
  assert.equal(tabStatus("error"), "error");
  assert.equal(tabStatus("idle"), "disconnected");
  assert.equal(tabStatus("closed"), "disconnected");
  assert.equal(statusLabel("disconnected"), "Disconnected");
  assert.equal(statusLabel("error"), "Error");
  tabs = closed.tabs;
  assert.equal(tabs.length, 1);
});

test("command history walks newest-first and ignores blanks and repeats", () => {
  let history = emptyHistory();
  history = pushHistory(history, "ls");
  history = pushHistory(history, "  ");
  history = pushHistory(history, "ls");
  history = pushHistory(history, "df -h");
  assert.deepEqual(history.entries, ["df -h", "ls"]);
  let step = stepHistory(history, -1);
  assert.equal(step.value, "df -h");
  history = step.history;
  step = stepHistory(history, -1);
  assert.equal(step.value, "ls");
  history = step.history;
  step = stepHistory(history, -1);
  assert.equal(step.value, "ls");
  step = stepHistory(step.history, 1);
  assert.equal(step.value, "df -h");
  step = stepHistory(step.history, 1);
  assert.equal(step.value, "");
  const long = Array.from({ length: 130 }, (_, i) => `cmd${i}`).reduce(pushHistory, emptyHistory());
  assert.equal(long.entries.length, MAX_HISTORY);
  assert.deepEqual(stepHistory(emptyHistory(), 1), { history: emptyHistory(), value: "" });
});

test("key bar sequences cover Esc, Tab, arrows, chords and sticky modifiers", () => {
  assert.equal(pressWithMods("\x1b", false, false), "\x1b");
  assert.equal(pressWithMods("c", true, false), "\x03");
  assert.equal(pressWithMods("C", true, false), "\x03");
  assert.equal(pressWithMods("a", false, true), "\x1ba");
  assert.equal(pressWithMods("c", true, true), "\x1b\x03");
  assert.equal(applyMods("\x1b[A", true, false), "\x1b[A");
  assert.equal(isPrintable("x"), true);
  assert.equal(isPrintable("xy"), false);
  assert.equal(isPrintable("\x7f"), false);
});

test("snippets map ids to shell commands and stay inert on unknown ids", () => {
  const ids = SNIPPETS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(snippetCommand("disk"), "df -h");
  assert.match(snippetCommand("docker"), /docker ps/);
  assert.match(snippetCommand("systemd"), /systemctl/);
  assert.equal(snippetCommand("missing"), "");
  assert.equal(SNIPPETS.every((s) => s.command.length > 0 && s.label.length > 0), true);
});

test("grid math clamps to the PTY dimension limits and reports equality", () => {
  assert.deepEqual(measureGrid(800, 480, { charWidth: 8, lineHeight: 20 }), { cols: 100, rows: 24 });
  assert.deepEqual(measureGrid(0, 0, { charWidth: 8, lineHeight: 20 }), { cols: MIN_COLS, rows: MIN_ROWS });
  assert.deepEqual(measureGrid(100000, 100000, { charWidth: 1, lineHeight: 1 }), { cols: MAX_COLS, rows: MAX_ROWS });
  assert.equal(gridEquals({ cols: 80, rows: 24 }, { cols: 80, rows: 24 }), true);
  assert.equal(gridEquals({ cols: 80, rows: 24 }, { cols: 81, rows: 24 }), false);
  assert.equal(gridEquals(measureGrid(1, 1, { charWidth: 8, lineHeight: 20 }), { cols: MIN_COLS, rows: MIN_ROWS }), true);
});

test("controller keeps SGR when asked and honours setSize for the next session", async () => {
  const states: TerminalState[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const sources: FakeEventSource[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return url.endsWith("/open") ? Response.json({ id: `pty-${sources.length + 1}` }) : Response.json({ ok: true });
  };
  const ctrl = createTerminalController((s) => states.push(s), {
    fetcher,
    bridge: { surface: "web", apiBaseOrigin: null },
    createEventSource: () => { const es = new FakeEventSource(); sources.push(es); return es; },
    preserveSgr: true,
  });
  ctrl.setSize(120, 40);
  ctrl.setSize(1, 1);
  await ctrl.connect();
  assert.deepEqual(requests[0], { cols: 120, rows: 40 });
  sources[0].emitOpen();
  sources[0].emitEvent("data", b64("\x1b[1;32mgreen\x1b[0m plain\r\n"));
  assert.equal(states.at(-1)?.output, "\x1b[1;32mgreen\x1b[0m plain\n");
  assert.equal(runsText(parseAnsiRuns(states.at(-1)!.output)), "green plain\n");
  ctrl.dispose();
});

test("terminal sources obey the repo UI gates: no @html, dialogs, storage or long lines", () => {
  const files = readdirSync(DIR).filter((name) => /\.(ts|svelte)$/.test(name));
  assert.ok(files.includes("TerminalApp.svelte"));
  for (const name of files) {
    const source = readFileSync(new URL(name, DIR), "utf8");
    assert.equal(source.includes("{@html"), false, `${name} uses {@html}`);
    assert.equal(/\bwindow\.(confirm|alert|prompt)\s*\(/.test(source), false, `${name} uses a native dialog`);
    assert.equal(/\b(localStorage|sessionStorage)\./.test(source), false, `${name} uses web storage`);
    assert.equal(source.includes("\u2014"), false, `${name} contains an em dash`);
    assert.equal(source.split("\n").every((line) => line.length <= 400), true, `${name} has a >400-char line`);
  }
});

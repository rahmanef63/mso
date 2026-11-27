import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baseName, isMarkdownFile, joinFsPath,
  lineColFromOffset, offsetForLine, parentDir,
} from "../src/lib/editor/editor-api.ts";
import {
  findMatches, replaceAllMatches, replaceMatchAt, tokenizeLines,
} from "../src/lib/editor/editor-highlight.ts";
import { parseMarkdownBlocks, parseMdInlines, sanitizeLinkHref } from "../src/lib/editor/editor-markdown.ts";
import { createMultiTabEditor, type MultiTabState } from "../src/lib/editor/editor-tabs.ts";

const EDITOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/editor");

test("path, cursor, and markdown detection helpers", () => {
  assert.equal(baseName("/home/demo/app.ts"), "app.ts");
  assert.equal(baseName("~/notes/"), "notes");
  assert.equal(parentDir("/home/demo/app.ts"), "/home/demo");
  assert.equal(joinFsPath("/home/demo", "sub/a.ts"), "/home/demo/sub/a.ts");
  assert.equal(joinFsPath("/", "etc"), "/etc");
  assert.equal(isMarkdownFile("README.md"), true);
  assert.equal(isMarkdownFile("notes.txt", "Markdown"), true);
  assert.equal(isMarkdownFile("app.ts", "TypeScript"), false);

  const sample = "line1\nline2\nline3";
  assert.deepEqual(lineColFromOffset(sample, 0), { ln: 1, col: 1 });
  assert.deepEqual(lineColFromOffset(sample, 8), { ln: 2, col: 3 });
  assert.equal(offsetForLine(sample, 1), 0);
  assert.equal(offsetForLine(sample, 2), 6);
  assert.equal(offsetForLine(sample, 99), 12);
});

test("multi-tab editor opens, switches, tracks aggregate dirty state, guards close, and restores snapshot", async () => {
  const states: MultiTabState[] = [];
  const dirtyEvents: boolean[] = [];
  const files = new Map<string, string>([
    ["/home/demo/a.ts", "const a = 1;\n"],
    ["/home/demo/b.md", "# Hello\n"],
  ]);

  const ed = createMultiTabEditor((next) => states.push(next), {
    onDirtyChange: (d) => dirtyEvents.push(d),
    fetcher: async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/fs/read") {
        const p = url.searchParams.get("path") ?? "";
        return files.has(p) ? Response.json(files.get(p)) : Response.json({ error: "missing" }, { status: 404 });
      }
      if (url.pathname === "/api/v1/fs/write") {
        const body = JSON.parse(String(init?.body)) as { path: string; content: string };
        files.set(body.path, body.content);
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected ${url.pathname}`);
    },
  });

  assert.equal(await ed.openTab("/home/demo/a.ts"), true);
  assert.equal(await ed.openTab("/home/demo/b.md"), true);
  assert.equal(states.at(-1)?.tabs.length, 2);
  assert.equal(states.at(-1)?.activePath, "/home/demo/b.md");
  assert.deepEqual(dirtyEvents, []);

  // Edit b.md -> anyDirty becomes true
  ed.updateContent("# Updated\n");
  assert.equal(states.at(-1)?.anyDirty, true);
  assert.deepEqual(dirtyEvents, [true]);

  // Switch to clean a.ts -> anyDirty stays true because b.md is still dirty
  ed.selectTab("/home/demo/a.ts");
  assert.equal(states.at(-1)?.activePath, "/home/demo/a.ts");
  assert.equal(states.at(-1)?.anyDirty, true);

  // Attempting to close dirty b.md without force requires confirmation
  assert.equal(ed.closeTab("/home/demo/b.md", false), "needs-confirm");
  assert.equal(states.at(-1)?.tabs.length, 2);

  // Snapshot and restore into fresh controller preserves both tabs and dirty draft
  const snap = ed.snapshot();
  const restoredStates: MultiTabState[] = [];
  const restoredDirty: boolean[] = [];
  const ed2 = createMultiTabEditor((s) => restoredStates.push(s), {
    onDirtyChange: (d) => restoredDirty.push(d),
  });
  assert.equal(ed2.restoreSnapshot(snap), true);
  assert.equal(restoredStates.at(-1)?.tabs.length, 2);
  assert.equal(restoredStates.at(-1)?.anyDirty, true);
  assert.deepEqual(restoredDirty, [true]);
  ed2.dispose();

  // Save b.md -> anyDirty returns to false
  assert.equal(await ed.saveTab("/home/demo/b.md"), true);
  assert.equal(files.get("/home/demo/b.md"), "# Updated\n");
  assert.equal(states.at(-1)?.anyDirty, false);
  assert.deepEqual(dirtyEvents, [true, false]);

  // Create new unsaved buffer, then force-close
  assert.equal(ed.createTab("/home/demo/new.ts", "export const x = 42;\n"), true);
  assert.equal(states.at(-1)?.anyDirty, true);
  assert.equal(ed.closeTab("/home/demo/new.ts", true), "closed");
  assert.equal(states.at(-1)?.anyDirty, false);
  ed.dispose();
});

test("safe tokenizer emits structured tokens without HTML and find/replace handles case sensitivity", () => {
  const tsLines = tokenizeLines("const x = 42; // note\nrun('hi')", "TypeScript");
  assert.equal(tsLines.length, 2);
  assert.ok(tsLines[0].some((t) => t.kind === "kw" && t.text === "const"));
  assert.ok(tsLines[0].some((t) => t.kind === "num" && t.text === "42"));
  assert.ok(tsLines[0].some((t) => t.kind === "cmt" && t.text.includes("// note")));
  assert.ok(tsLines[1].some((t) => t.kind === "fn" && t.text === "run"));
  assert.ok(tsLines[1].some((t) => t.kind === "str" && t.text === "'hi'"));

  const jsonLines = tokenizeLines('{"name": "mso", "ok": true}', "JSON");
  assert.ok(jsonLines[0].some((t) => t.kind === "fn" && t.text === '"name"'));
  assert.ok(jsonLines[0].some((t) => t.kind === "kw" && t.text === "true"));

  const doc = "Alpha beta\nalpha BETA\nALPHA";
  const ci = findMatches(doc, "alpha", false);
  assert.equal(ci.length, 3);
  assert.deepEqual({ line: ci[1].line, col: ci[1].col }, { line: 2, col: 1 });
  const cs = findMatches(doc, "alpha", true);
  assert.equal(cs.length, 1);
  assert.equal(replaceMatchAt(doc, cs[0], "gamma"), "Alpha beta\ngamma BETA\nALPHA");
  assert.deepEqual(replaceAllMatches(doc, "alpha", "X", false), { next: "X beta\nX BETA\nX", count: 3 });
});

test("markdown parser builds safe structured blocks and rejects unsafe link schemes", () => {
  assert.equal(sanitizeLinkHref("https://example.com/docs"), "https://example.com/docs");
  assert.equal(sanitizeLinkHref("/local/path"), "/local/path");
  assert.equal(sanitizeLinkHref("javascript:alert(1)"), null);
  assert.equal(sanitizeLinkHref("data:text/html,<script>"), null);

  const md = [
    "# Title **Bold**",
    "",
    "See `code` and [good](https://example.com) and [bad](javascript:alert(1)).",
    "",
    "- item 1",
    "- item 2",
    "",
    "```ts",
    "const ok = true;",
    "```",
    "",
    "> quoted line",
    "",
    "---",
  ].join("\n");

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[1].kind, "paragraph");
  const paraInlines = blocks[1].kind === "paragraph" ? blocks[1].inlines : [];
  assert.ok(paraInlines.some((i) => i.kind === "link" && i.href === "https://example.com/"));
  assert.ok(!paraInlines.some((i) => i.kind === "link" && i.text === "bad"));
  assert.equal(blocks[2].kind, "list");
  assert.equal(blocks[3].kind, "code");
  assert.equal(blocks[4].kind, "quote");
  assert.equal(blocks[5].kind, "hr");
  assert.ok(parseMdInlines("*italic*").some((i) => i.kind === "italic" && i.text === "italic"));
});

test("editor slice never posts to the headless image-doc endpoint", () => {
  // /api/v1/editor/exec is the image-editor doc command registry: it JSON.parses the
  // target file, and a non-JSON file is refused while a missing one is seeded with a
  // blank canvas doc. Pointing the code editor's Run at it both reported the wrong
  // thing (exit 0, no stdout) and offered to clobber the open file. The editor must
  // reach the host only through fs/read and fs/write.
  const files = readdirSync(EDITOR_DIR).filter((f) => /\.(ts|svelte)$/.test(f));
  for (const file of files) {
    const text = readFileSync(path.join(EDITOR_DIR, file), "utf8");
    assert.equal(text.includes("/api/v1/editor/exec"), false, `${file} must not call the headless doc endpoint`);
    assert.equal(/\/api\/v1\/exec\/run/.test(text), false, `${file} must not shell out from the editor window`);
  }
});

test("editor integrates the real PTY terminal instead of a fake console", () => {
  // The Run drawer was removed because /api/v1/editor/exec is the image-doc registry.
  // The one honest console in this window is the terminal slice's PTY pane, which the
  // host and both proxies already allowlist. This guard keeps that wiring in place and
  // stops anyone re-adding a private fetch path.
  const app = readFileSync(path.join(EDITOR_DIR, "CodeEditorApp.svelte"), "utf8");
  const toolbar = readFileSync(path.join(EDITOR_DIR, "EditorToolbar.svelte"), "utf8");
  const drawer = readFileSync(path.join(EDITOR_DIR, "EditorTerminalDrawer.svelte"), "utf8");

  assert.ok(app.includes("EditorTerminalDrawer"), "editor must mount the terminal drawer");
  assert.ok(app.includes("terminalCwd"), "editor must pass a working directory to the drawer");
  assert.ok(toolbar.includes("onToggleTerminal"), "toolbar must expose the terminal toggle");

  // The drawer delegates to the terminal slice so PTY lifecycle, resize, ANSI safety
  // and the Owner-role hint stay in one implementation.
  assert.ok(drawer.includes("../terminal/TerminalPane.svelte"), "drawer must reuse TerminalPane");
  for (const file of [app, toolbar, drawer]) {
    assert.equal(/\bfetch\s*\(/.test(file), false, "editor terminal wiring must not fetch directly");
  }
  const editorDirFiles = readdirSync(EDITOR_DIR).filter((f) => /\.(ts|svelte)$/.test(f));
  assert.ok(editorDirFiles.includes("EditorTerminalDrawer.svelte"));
});

test("hard repo gates hold across all editor slice files", () => {
  const files = readdirSync(EDITOR_DIR).filter((f) => /\.(ts|svelte)$/.test(f));
  assert.ok(files.length >= 9);
  for (const file of files) {
    const text = readFileSync(path.join(EDITOR_DIR, file), "utf8");
    const lines = text.split("\n");
    assert.ok(lines.length <= 250, `${file} has ${lines.length} lines (keep modular <250)`);
    assert.equal(text.includes("{@html"), false, `${file} must not use {@html}`);
    assert.equal(/\bwindow\.(confirm|alert|prompt)\s*\(/.test(text), false, `${file} must not call window.confirm/alert/prompt`);
    assert.equal(/\b(localStorage|sessionStorage)\./.test(text), false, `${file} must not use Web Storage`);
    assert.equal(text.includes("\u2014"), false, `${file} must not contain em dashes`);
    assert.equal(lines.some((line) => line.length > 400), false, `${file} has a line over 400 chars`);
  }
});

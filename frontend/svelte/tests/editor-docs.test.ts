import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, countStats, createEditorController, detectLanguage, type EditorState,
} from "../src/lib/editor/editor-api.ts";
import {
  createDocsController, parseChangelogSections, readChangelog, type DocsState,
} from "../src/lib/docs/docs-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown, status = 200): typeof fetch => async () =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

test("detectLanguage resolves extensions, special filenames, and fallbacks", () => {
  const cases: Array<[string, string]> = [
    ["src/app.ts", "TypeScript"], ["src/view.tsx", "TypeScript JSX"],
    ["frontend/App.svelte", "Svelte"], ["rust-shell/src/main.rs", "Rust"],
    ["scripts/check.PY", "Python"], ["/opt/mso/Dockerfile", "Dockerfile"],
    ["Dockerfile.prod", "Dockerfile"], ["Makefile", "Makefile"],
    [".env.local", "Env"], ["README.md", "Markdown"], ["config.yaml", "YAML"],
    ["notes.unknown", "Plain Text"], ["", "Plain Text"],
  ];
  for (const [path, expected] of cases) assert.equal(detectLanguage(path), expected);
});

test("countStats reports lines, characters, and UTF-8 bytes", () => {
  assert.deepEqual(countStats(""), { lines: 0, chars: 0, bytes: 0 });
  assert.deepEqual(countStats("hello"), { lines: 1, chars: 5, bytes: 5 });
  assert.deepEqual(countStats("a\nb\nc"), { lines: 3, chars: 5, bytes: 5 });
  assert.deepEqual(countStats("a\r\nb"), { lines: 2, chars: 4, bytes: 4 });
  const utf8 = "café 🚀";
  assert.deepEqual(countStats(utf8), { lines: 1, chars: utf8.length, bytes: new TextEncoder().encode(utf8).length });
  assert.ok(countStats(utf8).bytes > countStats(utf8).chars);
});

test("createEditorController handles open, dirty edits, revert, and save", async () => {
  const states: EditorState[] = [];
  const dirtyEvents: boolean[] = [];
  let savedPayload: Record<string, unknown> | null = null;

  const ctrl = createEditorController((next) => states.push(next), {
    onDirtyChange: (dirty) => dirtyEvents.push(dirty),
    fetcher: async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/v1/fs/read?")) {
        assert.equal(init?.method, "GET");
        return Response.json("const x = 1;\n");
      }
      if (url === "/api/v1/fs/write") {
        assert.equal(init?.method, "POST");
        savedPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected url: ${url}`);
    },
  });

  assert.equal(await ctrl.open("src/demo.ts"), true);
  let last = states.at(-1);
  assert.equal(last?.kind, "ready");
  assert.equal(last.language, "TypeScript");
  assert.equal(last.dirty, false);

  ctrl.updateContent("const x = 2;\n");
  last = states.at(-1);
  assert.equal(last?.kind, "ready");
  assert.equal(last.dirty, true);
  assert.deepEqual(dirtyEvents, [true]);

  ctrl.revert();
  last = states.at(-1);
  assert.equal(last?.kind, "ready");
  assert.equal(last.content, "const x = 1;\n");
  assert.equal(last.dirty, false);
  assert.equal(last.notice, "Reverted unsaved changes.");

  ctrl.updateContent("const x = 3;\n");
  assert.equal(await ctrl.save(), true);
  assert.deepEqual(savedPayload, { path: "src/demo.ts", content: "const x = 3;\n" });
  last = states.at(-1);
  assert.equal(last?.kind, "ready");
  assert.equal(last.dirty, false);
  assert.equal(last.savedContent, "const x = 3;\n");
  assert.equal(last.notice, "File saved.");
  assert.deepEqual(dirtyEvents, [true, false, true, false]);
  ctrl.dispose();
});

test("createEditorController handles open/save errors and dispose cancellation", async () => {
  const states: EditorState[] = [];
  let aborted = false;
  let resolveSlow!: (res: Response) => void;
  let mode: "fail-open" | "ok-open" | "fail-save" | "slow" = "fail-open";

  const ctrl = createEditorController((next) => states.push(next), {
    fetcher: async (_input, init) => {
      if (mode === "fail-open") return Response.json({ error: "missing" }, { status: 404 });
      if (mode === "ok-open") return Response.json("hello");
      if (mode === "fail-save") return Response.json({ error: "denied" }, { status: 403 });
      init?.signal?.addEventListener("abort", () => { aborted = true; });
      return new Promise<Response>((resolve) => { resolveSlow = resolve; });
    },
  });

  assert.equal(await ctrl.open("   "), false);
  assert.equal(states.at(-1)?.kind, "error");
  assert.equal(await ctrl.open("missing.ts"), false);
  const openErr = states.at(-1);
  assert.equal(openErr?.kind, "error");
  assert.match(openErr.message, /not found/i);

  mode = "ok-open";
  assert.equal(await ctrl.open("notes.txt"), true);
  ctrl.updateContent("updated");
  mode = "fail-save";
  assert.equal(await ctrl.save(), false);
  const saveErr = states.at(-1);
  assert.equal(saveErr?.kind, "ready");
  assert.equal(saveErr.dirty, true);
  assert.equal(saveErr.content, "updated");
  assert.match(saveErr.actionError ?? "", /Write permission required/i);

  mode = "slow";
  const inflight = ctrl.open("slow.ts");
  ctrl.dispose();
  resolveSlow(Response.json("late"));
  assert.equal(await inflight, false);
  assert.equal(aborted, true);
});

test("readChangelog validates payloads, bridge origins, and error statuses", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const ok = await readChangelog(signal, async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/changelog");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    return Response.json({ markdown: "## 2026-11-21\n- Added editor", generated: true });
  }, bridge);
  assert.deepEqual(ok, { markdown: "## 2026-11-21\n- Added editor", generated: true });
  assert.deepEqual(await readChangelog(signal, jsonOf({ markdown: "", generated: false })), { markdown: "", generated: false });

  for (const bad of [null, [], "md", { markdown: 123, generated: true }, { markdown: "", generated: "yes" }]) {
    await assert.rejects(readChangelog(signal, jsonOf(bad)), (e: unknown) => e instanceof ApiError && e.status === 502);
  }
  await assert.rejects(
    readChangelog(signal, async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })),
    (e: unknown) => e instanceof ApiError && e.status === 502 && /API is unavailable/.test(e.message),
  );
  for (const status of [401, 403]) {
    await assert.rejects(
      readChangelog(signal, jsonOf({ error: "secret internal detail" }, status)),
      (e: unknown) => e instanceof ApiError && e.status === status && !e.message.includes("secret internal detail"),
    );
  }
});

test("parseChangelogSections extracts safe structured blocks and controller handles states", async () => {
  const md = [
    "# Changelog", "", "**Generated.**", "", "## 2026-11-21", "", "**Added**", "",
    "- `editor` add **code editor** and [docs](https://example.com) (#350)", "",
    "**Fixed**", "", "- escape <script>alert(1)</script> cleanly", "",
    "## Empty Date", "", "## 2026-11-20", "- Standalone bullet",
  ].join("\n");

  assert.deepEqual(parseChangelogSections(md), [
    { heading: "2026-11-21", items: ["Added: editor add code editor and docs (#350)", "Fixed: escape <script>alert(1)</script> cleanly"] },
    { heading: "2026-11-20", items: ["Standalone bullet"] },
  ]);
  assert.deepEqual(parseChangelogSections(""), []);
  assert.deepEqual(parseChangelogSections("- Orphan bullet"), [{ heading: "Updates", items: ["Orphan bullet"] }]);

  const states: DocsState[] = [];
  const ctrl = createDocsController((next) => states.push(next), { fetcher: jsonOf({ markdown: "", generated: false }) });
  await ctrl.refresh();
  const ready = states.at(-1);
  assert.equal(ready?.kind, "ready");
  assert.equal(ready.generated, false);
  assert.deepEqual(ready.sections, []);
  ctrl.dispose();
});

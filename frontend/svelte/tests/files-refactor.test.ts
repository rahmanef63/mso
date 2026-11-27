import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  buildRawFileUrl,
  buildZipDownloadUrl,
  fetchFsUsage,
  uploadFsFiles,
} from "../src/lib/files/files-extended-api.ts";
import {
  batchDeleteFsEntries,
  batchTransferFsEntries,
  renameFsEntry,
} from "../src/lib/files/files-batch-api.ts";
import {
  entryBadgeText,
  entryKindLabel,
  entryExt,
  filterAndSortEntries,
  formatMtime,
  isHiddenEntry,
  mediaKindFor,
} from "../src/lib/files/files-entry-meta.ts";
import { parseMarkdownBlocks } from "../src/lib/files/files-markdown.ts";
import { ApiError } from "../src/lib/files/files-api.ts";

const DIR = new URL("../src/lib/files/", import.meta.url);
const signal = new AbortController().signal;

const entries = [
  { name: ".env", kind: "file" as const, size: 12, ext: "env" },
  { name: "zebra.png", kind: "file" as const, size: 900, ext: "png", mtime: 1_700_000_000_000 },
  { name: "alpha.md", kind: "file" as const, size: 30, ext: "md", mtime: 1_600_000_000_000 },
  { name: "docs", kind: "dir" as const, size: 0 },
  { name: "app", kind: "dir" as const, size: 0 },
];

test("filterAndSortEntries keeps folders first and honours field, direction, query and dotfiles", () => {
  const byName = filterAndSortEntries(entries, { showHidden: true });
  assert.deepEqual(byName.map((e) => e.name), ["app", "docs", ".env", "alpha.md", "zebra.png"]);

  const desc = filterAndSortEntries(entries, { sort: { field: "size", dir: "desc" } });
  assert.deepEqual(desc.filter((e) => e.kind === "file").map((e) => e.name), ["zebra.png", "alpha.md", ".env"]);

  const byMtime = filterAndSortEntries(entries, { sort: { field: "mtime", dir: "desc" } });
  assert.equal(byMtime.filter((e) => e.kind === "file")[0].name, "zebra.png");

  const filtered = filterAndSortEntries(entries, { query: "ALP" });
  assert.deepEqual(filtered.map((e) => e.name), ["alpha.md"]);

  const noHidden = filterAndSortEntries(entries, { showHidden: false });
  assert.equal(noHidden.some((e) => e.name === ".env"), false);

  // Every sort keeps directories ahead of files regardless of direction.
  for (const dir of ["asc", "desc"] as const) {
    for (const field of ["name", "size", "mtime", "kind"] as const) {
      const sorted = filterAndSortEntries(entries, { sort: { field, dir } });
      const firstFile = sorted.findIndex((e) => e.kind === "file");
      const lastDir = sorted.map((e) => e.kind).lastIndexOf("dir");
      assert.ok(lastDir < firstFile, `${field}/${dir} let a folder trail a file`);
    }
  }

  // Input order must not be mutated: the listing is shared with the controller.
  const copy = entries.map((e) => e.name);
  filterAndSortEntries(entries, { sort: { field: "size", dir: "desc" } });
  assert.deepEqual(entries.map((e) => e.name), copy);
});

test("entry metadata classifies media, labels kinds and badges, and formats mtime", () => {
  assert.equal(mediaKindFor("photo.PNG"), "image");
  assert.equal(mediaKindFor("clip.mp4"), "video");
  assert.equal(mediaKindFor("track.flac"), "audio");
  assert.equal(mediaKindFor("notes.md"), "markdown");
  assert.equal(mediaKindFor("main.ts"), "code");
  assert.equal(mediaKindFor("bundle.zip"), "binary");
  assert.equal(mediaKindFor("plain"), "text");
  // A declared mime wins over the extension so a renamed file still previews right.
  assert.equal(mediaKindFor({ name: "data.bin", mime: "image/webp" }), "image");

  assert.equal(entryExt({ name: "archive.tar.gz", ext: "" }), "gz");
  assert.equal(entryExt({ name: ".env", ext: "" }), "");
  assert.equal(entryExt({ name: "noext", ext: "" }), "");

  assert.equal(entryKindLabel({ name: "docs", kind: "dir", ext: "" }), "Folder");
  assert.equal(entryKindLabel({ name: "a.png", kind: "file", ext: "png" }), "PNG image");
  assert.equal(entryKindLabel({ name: "a.ts", kind: "file", ext: "ts" }), "TS code");
  assert.equal(entryKindLabel({ name: "a.zip", kind: "file", ext: "zip" }), "Archive");

  assert.equal(entryBadgeText({ name: "docs", kind: "dir", ext: "" }), "DIR");
  assert.equal(entryBadgeText({ name: "a.png", kind: "file", ext: "png" }), "PNG");
  assert.equal(entryBadgeText({ name: "a.jpeg", kind: "file", ext: "jpeg" }), "JPEG");
  // An unrecognised long extension falls back to a generic FILE badge.
  assert.equal(entryBadgeText({ name: "a.unknownext", kind: "file", ext: "unknownext" }), "FILE");

  assert.equal(isHiddenEntry({ name: ".git" }), true);
  assert.equal(isHiddenEntry({ name: "git" }), false);

  assert.equal(formatMtime(0), "-");
  assert.equal(formatMtime(undefined), "-");
  assert.equal(formatMtime(Number.NaN), "-");
  assert.match(formatMtime(Date.UTC(2026, 0, 2, 3, 4)), /^2026-01-02 \d{2}:\d{2}$/);
});

test("parseMarkdownBlocks emits headings, fenced code, quotes, lists and paragraphs without HTML", () => {
  const blocks = parseMarkdownBlocks([
    "# Title",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "> quoted",
    "",
    "- one",
    "- two",
    "",
    "plain paragraph",
  ].join("\n"));
  assert.deepEqual(blocks, [
    { kind: "heading", level: 1, text: "Title" },
    { kind: "code", lang: "ts", text: "const x = 1;" },
    { kind: "quote", text: "quoted" },
    { kind: "list", items: ["one", "two"] },
    { kind: "paragraph", text: "plain paragraph" },
  ]);
  // Unterminated fences still produce one code block instead of swallowing nothing.
  assert.deepEqual(parseMarkdownBlocks("```\nopen"), [{ kind: "code", lang: "", text: "open" }]);
  assert.equal(JSON.stringify(blocks).includes("<"), false);
});

test("buildRawFileUrl and buildZipDownloadUrl encode real API contracts and reject bad input", () => {
  const bridge = { surface: "web" as const, apiBaseOrigin: null };
  assert.equal(
    buildRawFileUrl("/srv/workspace/a b.txt", bridge),
    "/api/v1/fs/raw?path=%2Fsrv%2Fworkspace%2Fa+b.txt",
  );
  assert.throws(() => buildRawFileUrl("/srv/../etc/passwd", bridge), /parent traversal/);

  const zip = buildZipDownloadUrl("/srv/workspace", ["a.txt", "docs"], { name: "backup", exclude: ["node_modules"] }, bridge);
  assert.ok(zip.startsWith("/api/v1/fs/zip?"));
  const params = new URLSearchParams(zip.slice(zip.indexOf("?") + 1));
  assert.equal(params.get("base"), "/srv/workspace");
  assert.deepEqual(params.getAll("n"), ["a.txt", "docs"]);
  assert.deepEqual(params.getAll("x"), ["node_modules"]);
  assert.equal(params.get("name"), "backup.zip");

  assert.throws(() => buildZipDownloadUrl("/srv", [], {}, bridge), /at least one item/);
  assert.throws(() => buildZipDownloadUrl("/srv", ["../escape"], {}, bridge), /single segment/);
  const named = buildZipDownloadUrl("/srv", ["a"], { name: "my files!" }, bridge);
  assert.equal(new URLSearchParams(named.slice(named.indexOf("?") + 1)).get("name"), "my_files_.zip");
});

test("fetchFsUsage accepts disk and folder shapes, sends no-store GETs and fails closed", async () => {
  const seen: string[] = [];
  const disk = await fetchFsUsage("/srv/workspace", signal, async (input, init) => {
    seen.push(String(input));
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    return Response.json({ used: 25, total: 100 });
  }, { surface: "web", apiBaseOrigin: null });
  assert.deepEqual(disk, { kind: "disk", used: 25, total: 100, ratio: 0.25 });
  assert.deepEqual(seen, ["/api/v1/fs/usage?path=%2Fsrv%2Fworkspace"]);

  const folder = await fetchFsUsage(undefined, signal, async () => Response.json({ bytes: 10, files: 2, dirs: 1 }),
    { surface: "web", apiBaseOrigin: null });
  assert.deepEqual(folder, { kind: "folder", bytes: 10, files: 2, dirs: 1 });

  // Zero total must not divide into NaN.
  const empty = await fetchFsUsage(undefined, signal, async () => Response.json({ used: 0, total: 0 }),
    { surface: "web", apiBaseOrigin: null });
  assert.equal(empty.kind === "disk" ? empty.ratio : -1, 0);

  for (const body of [{}, { used: -1, total: 10 }, { bytes: "10", files: 2 }, null]) {
    await assert.rejects(
      fetchFsUsage(undefined, signal, async () => Response.json(body), { surface: "web", apiBaseOrigin: null }),
      (err: unknown) => err instanceof ApiError && err.status === 502,
    );
  }
  // An HTML body is not usage data even when the status is 200.
  await assert.rejects(
    fetchFsUsage(undefined, signal, async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
      { surface: "web", apiBaseOrigin: null }),
    (err: unknown) => err instanceof ApiError && /unavailable/i.test(err.message),
  );
  await assert.rejects(
    fetchFsUsage(undefined, signal, async () => Response.json({}, { status: 429 }), { surface: "web", apiBaseOrigin: null }),
    (err: unknown) => err instanceof ApiError && err.status === 429,
  );
});

test("uploadFsFiles posts multipart with dest first and reports progress and failures", async () => {
  const file = new File(["hello"], "a.txt", { type: "text/plain" });
  const items = [{ relPath: "nested/a.txt", file }];
  const progress: number[] = [];
  let body: FormData | undefined;

  const outcome = await uploadFsFiles("/srv/workspace", items, signal, {
    bridge: { surface: "web", apiBaseOrigin: null },
    onProgress: (p) => progress.push(p.pct),
    fetcher: async (_input, init) => {
      body = init?.body as FormData;
      assert.equal(init?.method, "POST");
      assert.equal(init?.cache, "no-store");
      return Response.json({ written: 1, failed: [] });
    },
  });
  assert.deepEqual(outcome, { written: 1, failed: [] });
  assert.deepEqual(progress, [0, 100]);
  assert.ok(body instanceof FormData);
  // Dest must lead the parts; the server reads it before streaming files.
  assert.equal([...body.keys()][0], "dest");
  assert.equal(body.get("dest"), "/srv/workspace");
  // The stored filename carries the dropped folder, so uploads keep their tree.
  assert.equal((body.get("file") as File).name, "nested/a.txt");

  await assert.rejects(
    uploadFsFiles("/srv/workspace", [], signal, { bridge: { surface: "web", apiBaseOrigin: null } }),
    /at least one file/,
  );
  await assert.rejects(
    uploadFsFiles("../etc", items, signal, { bridge: { surface: "web", apiBaseOrigin: null } }),
    /parent traversal/,
  );
  await assert.rejects(
    uploadFsFiles("/srv", items, signal, {
      bridge: { surface: "web", apiBaseOrigin: null },
      fetcher: async () => Response.json({ written: 1 }, { status: 413 }),
    }),
    (err: unknown) => err instanceof ApiError && err.status === 413,
  );
  await assert.rejects(
    uploadFsFiles("/srv", items, signal, {
      bridge: { surface: "web", apiBaseOrigin: null },
      fetcher: async () => Response.json({ wrong: true }),
    }),
    /Upload response is invalid/,
  );
});

test("batch and rename helpers call the live fs routes and isolate per-entry failures", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    if (url.startsWith("/api/v1/fs/move") && url.includes('"to":"/srv/workspace/bad.txt"')) {
      return new Response("nope", { status: 409 });
    }
    return Response.json({ ok: true });
  };
  const bridge = { surface: "web" as const, apiBaseOrigin: null };

  assert.equal(await renameFsEntry("/srv/workspace", "old.txt", "new.txt", signal, fetcher, bridge), "new.txt");
  assert.equal(calls[0].url, "/api/v1/fs/move");
  assert.equal(calls[0].method, "POST");

  await assert.rejects(renameFsEntry("/srv", "a.txt", "a.txt", signal, fetcher, bridge), /must differ/);
  await assert.rejects(renameFsEntry("/srv", "a/b", "c", signal, fetcher, bridge), /single segment/);

  const deleted = await batchDeleteFsEntries("/srv/workspace", ["one", "two"], signal, fetcher, bridge);
  assert.deepEqual(deleted, { deleted: ["one", "two"], failed: [] });
  assert.equal(calls.filter((c) => c.url === "/api/v1/fs/delete").length, 2);
  assert.equal(calls.find((c) => c.url === "/api/v1/fs/delete")?.method, "DELETE");

  const transfer = await batchTransferFsEntries("copy", "/srv/a", ["x", "y"], "/srv/b", signal, fetcher, bridge);
  assert.deepEqual(transfer, { transferred: ["x", "y"], failed: [] });
  assert.ok(calls.some((c) => c.url === "/api/v1/fs/copy" && c.method === "POST"));

  // An invalid destination is rejected before any request is issued.
  await assert.rejects(
    batchTransferFsEntries("move", "/srv/a", ["x"], "/srv/../etc", signal, fetcher, bridge),
    /parent traversal/,
  );
  // One failing entry is reported per item; the batch still returns a full report.
  const partial = await batchTransferFsEntries("copy", "/srv/a", ["x", "../bad"], "/srv/b", signal, fetcher, bridge);
  assert.deepEqual(partial, { transferred: ["x"], failed: ["../bad"] });

  // An aborted signal stops the loop instead of firing every remaining request.
  const aborted = new AbortController();
  aborted.abort();
  const stopped = await batchDeleteFsEntries("/srv", ["a", "b"], aborted.signal, fetcher, bridge);
  assert.deepEqual(stopped, { deleted: [], failed: [] });
});

test("files module obeys the repo UI gates: no @html, dialogs, storage, em dashes or long lines", () => {
  const files = readdirSync(DIR).filter((name) => /\.(ts|svelte)$/.test(name));
  assert.ok(files.includes("FilesManager.svelte"));
  assert.ok(files.includes("FilesQuickLook.svelte"));
  assert.ok(files.includes("FilesGridView.svelte"));
  for (const name of files) {
    const source = readFileSync(new URL(name, DIR), "utf8");
    assert.equal(source.includes("{@html"), false, `${name} uses {@html}`);
    assert.equal(/\bwindow\.(confirm|alert|prompt)\s*\(/.test(source), false, `${name} uses a native dialog`);
    assert.equal(/\b(localStorage|sessionStorage)\./.test(source), false, `${name} uses web storage`);
    assert.equal(source.includes("\u2014"), false, `${name} contains an em dash`);
    assert.equal(source.split("\n").every((line) => line.length <= 400), true, `${name} has a >400-char line`);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ApiError, copyFsEntry, moveFsEntry, searchFs, validateFsPath,
} from "../src/lib/files/files-ops-api.ts";

const readRel = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const lineCount = (src: string) => src.split("\n").length - (src.endsWith("\n") ? 1 : 0);

const COMPONENT_SPECS = [
  { name: "FilesOpsPanel.svelte", rel: "../src/lib/files/FilesOpsPanel.svelte", maxLines: 190 },
  { name: "FilesManager.svelte", rel: "../src/lib/files/FilesManager.svelte", maxLines: 210 },
  { name: "WorkflowGraphCanvas.svelte", rel: "../src/lib/workflows/WorkflowGraphCanvas.svelte", maxLines: 180 },
  { name: "WorkflowsApp.svelte", rel: "../src/lib/workflows/WorkflowsApp.svelte", maxLines: 210 },
] as const;

test("Inc 4 Svelte components satisfy line-count, antislop, and rune naming invariants", () => {
  for (const spec of COMPONENT_SPECS) {
    const src = readRel(spec.rel);
    const lines = lineCount(src);
    assert.ok(lines <= spec.maxLines, `${spec.name} has ${lines} lines (limit ${spec.maxLines})`);
    assert.ok(lines <= 210, `${spec.name} exceeds global 210-line ratchet (${lines})`);
    assert.equal(src.includes("\u2014"), false, `${spec.name} must not contain em dashes (U+2014)`);
    assert.equal(
      /\b(?:let|const)\s+state\s*=\s*\$state\b/.test(src),
      false,
      `${spec.name} must not declare a $state variable named "state"`,
    );
    const maxLineLen = Math.max(...src.split("\n").map((l) => l.length));
    assert.ok(maxLineLen <= 400, `${spec.name} has a line of ${maxLineLen} chars (> 400 limit)`);
  }
});

test("FilesManager wires FilesOpsPanel while preserving existing E2E selectors and labels", () => {
  const ops = readRel("../src/lib/files/FilesOpsPanel.svelte");
  for (const symbol of ["searchFs", "copyFsEntry", "moveFsEntry", "./files-ops-api.ts"]) {
    assert.equal(ops.includes(symbol), true, `FilesOpsPanel.svelte missing ${symbol}`);
  }
  for (const prop of ["currentPath", "onOpenResult", "onMutated", "Copy / Move", "Source path", "Destination path"]) {
    assert.equal(ops.includes(prop), true, `FilesOpsPanel.svelte missing ${prop}`);
  }

  const mgr = readRel("../src/lib/files/FilesManager.svelte");
  assert.equal(mgr.includes('import FilesOpsPanel from "./FilesOpsPanel.svelte"'), true);
  assert.equal(mgr.includes("<FilesOpsPanel"), true);
  for (const hook of [
    "data-files-state", "data-entry-open", "data-delete-entry",
    "New folder", "Edit", "Save", "Confirm delete",
  ]) {
    assert.equal(mgr.includes(hook), true, `FilesManager.svelte must preserve "${hook}"`);
  }
});

test("WorkflowsApp wires WorkflowGraphCanvas with accessible SVG preview and status tokens", () => {
  const canvas = readRel("../src/lib/workflows/WorkflowGraphCanvas.svelte");
  for (const token of [
    "export function layoutWorkflowPreview",
    "<svg",
    'role="img"',
    "aria-label=",
    "Workflow topology preview for ",
    "var(--ok)",
    "var(--warn)",
    "var(--muted)",
  ]) {
    assert.equal(canvas.includes(token), true, `WorkflowGraphCanvas.svelte missing ${token}`);
  }

  const app = readRel("../src/lib/workflows/WorkflowsApp.svelte");
  assert.equal(app.includes('import WorkflowGraphCanvas from "./WorkflowGraphCanvas.svelte"'), true);
  assert.equal(app.includes("<WorkflowGraphCanvas"), true);
  assert.equal(app.includes("Inspect graph"), true);
});

test("files-ops-api integration helpers handle search, copy, move, and safe error mapping", async () => {
  const signal = new AbortController().signal;
  const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method: init?.method, body });
    if (url.startsWith("/api/v1/fs/search")) {
      return Response.json([
        { name: "readme.md", path: "/srv/workspace/readme.md", kind: "file" },
        { name: "docs", path: "/srv/workspace/docs", kind: "dir" },
      ]);
    }
    return Response.json({ ok: true });
  };

  assert.equal(validateFsPath(" /srv/workspace "), "/srv/workspace");
  assert.deepEqual(await searchFs("   ", "/srv/workspace", signal, fetcher), []);

  const hits = await searchFs("read", "/srv/workspace", signal, fetcher);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.path, "/srv/workspace/readme.md");
  assert.equal(hits[1]?.kind, "dir");

  await copyFsEntry("/srv/workspace/a.txt", "/srv/workspace/b.txt", signal, fetcher);
  await moveFsEntry("/srv/workspace/b.txt", "/srv/workspace/c.txt", signal, fetcher);

  assert.deepEqual(requests, [
    { url: "/api/v1/fs/search?q=read&root=%2Fsrv%2Fworkspace", method: "GET", body: undefined },
    { url: "/api/v1/fs/copy", method: "POST", body: { from: "/srv/workspace/a.txt", to: "/srv/workspace/b.txt" } },
    { url: "/api/v1/fs/move", method: "POST", body: { from: "/srv/workspace/b.txt", to: "/srv/workspace/c.txt" } },
  ]);

  await assert.rejects(
    copyFsEntry("/srv/a", "/srv/a", signal, fetcher),
    (err: unknown) => err instanceof ApiError && err.status === 400,
  );
  await assert.rejects(
    moveFsEntry("/srv/a", "/srv/a/sub", signal, fetcher),
    (err: unknown) => err instanceof ApiError && err.status === 400,
  );
  await assert.rejects(
    searchFs("q", "/srv/../etc", signal, fetcher),
    (err: unknown) => err instanceof ApiError && err.status === 400,
  );
  await assert.rejects(
    moveFsEntry("/srv/a", "/srv/b", signal, async () => Response.json({ error: "secret-stack" }, { status: 403 })),
    (err: unknown) => err instanceof ApiError && err.status === 403 && !err.message.includes("secret-stack"),
  );
});

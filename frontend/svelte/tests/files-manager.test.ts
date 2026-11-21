import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, listDirectory, readTextFile } from "../src/lib/files/files-api.ts";
import { createFilesController, type FilesState } from "../src/lib/files/files-controller.ts";

const signal = new AbortController().signal;
const listing = {
  path: "/srv/workspace",
  parent: "/srv",
  roots: [{ label: "Workspace", path: "/srv/workspace" }],
  entries: [
    { name: "z-file.txt", kind: "file" as const, size: 42, ext: "txt" },
    { name: "docs", kind: "dir" as const, size: 0 },
    { name: "a-file.md", kind: "file" as const, size: 128, ext: "md" },
    { name: "app", kind: "dir" as const, size: 0 },
  ],
};

test("listDirectory and readTextFile issue same-origin uncached GETs and validate real DTO shapes", async () => {
  const seen: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    return url.startsWith("/api/v1/fs/list") ? Response.json(listing) : Response.json("hello from mso\n");
  };
  const dir = await listDirectory("/srv/workspace", signal, fetcher);
  assert.equal(dir.path, "/srv/workspace");
  assert.equal(dir.entries.length, 4);
  assert.equal(await readTextFile("/srv/workspace/a-file.md", signal, fetcher), "hello from mso\n");
  assert.deepEqual(seen, ["/api/v1/fs/list?path=%2Fsrv%2Fworkspace", "/api/v1/fs/read?path=%2Fsrv%2Fworkspace%2Fa-file.md"]);
});

test("files-api supports desktop shell bridge origin and fails closed on invalid shapes, HTML, or errors", async () => {
  const bridge = { surface: "tauri-desktop" as const, apiBaseOrigin: "http://127.0.0.1:3000" };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:3000/api/v1/fs/list?path=%7E");
    assert.equal(init?.credentials, "include");
    return Response.json({ path: "/srv", entries: [], parent: null });
  };
  assert.equal((await listDirectory("~", signal, fetcher, bridge)).path, "/srv");

  const invalidLists = [null, {}, { path: "", entries: [] }, { path: "/srv", entries: [{ name: "x", kind: "link", size: 0 }] }, { path: "/srv", entries: [{ name: "x", kind: "file", size: -1 }] }];
  for (const body of invalidLists) {
    await assert.rejects(listDirectory("~", signal, async () => Response.json(body)), /directory listing response is invalid/);
  }
  await assert.rejects(readTextFile("/srv/a.txt", signal, async () => Response.json({ content: "wrong shape" })), /file read response is invalid/);
  await assert.rejects(listDirectory("~", signal, async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })), /API is unavailable/);

  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      listDirectory("~", signal, async () => Response.json({ error: "secret stack trace detail" }, { status })),
      (err: unknown) => err instanceof ApiError && err.status === status && !err.message.includes("secret stack trace"),
    );
  }
});

test("files-controller sorts dirs before files, navigates parent, previews files, and handles empty dirs", async () => {
  const states: FilesState[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("/api/v1/fs/read")) return Response.json("# Heading\nbody");
    if (url.includes("path=%2Fsrv%2Fworkspace")) return Response.json(listing);
    if (url.includes("path=%2Fsrv")) return Response.json({ path: "/srv", parent: null, entries: [] });
    return Response.json({ error: "not found" }, { status: 404 });
  };
  const ctrl = createFilesController((s) => states.push(s), { fetcher });
  await ctrl.openDir("/srv/workspace");
  const ready = states.at(-1);
  assert.equal(ready?.kind, "ready");
  assert.deepEqual(ready.entries.map((e) => e.name), ["app", "docs", "a-file.md", "z-file.txt"]);

  await ctrl.openFile(ready.entries[2]);
  const withPreview = states.at(-1);
  assert.equal(withPreview?.kind, "ready");
  assert.equal(withPreview.preview.kind, "ready");
  assert.equal(withPreview.preview.content, "# Heading\nbody");

  ctrl.closePreview();
  const closed = states.at(-1);
  assert.equal(closed?.kind, "ready");
  assert.equal(closed.preview.kind, "idle");

  await ctrl.goParent();
  const parentReady = states.at(-1);
  assert.equal(parentReady?.kind, "ready");
  assert.equal(parentReady.path, "/srv");
  assert.deepEqual(parentReady.entries, []);
  await ctrl.goParent();
  assert.equal(states.at(-1)?.path, "/srv");
  ctrl.dispose();
});

test("files-controller aborts stale directory/preview requests, recovers on refresh, and respects dispose", async () => {
  const states: FilesState[] = [];
  let resolveSlowDir!: (r: Response) => void;
  let slowSignal: AbortSignal | null | undefined;
  let failNext = false;
  let calls = 0;

  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    const url = String(input);
    if (calls === 1) {
      slowSignal = init?.signal;
      return new Promise<Response>((resolve) => { resolveSlowDir = resolve; });
    }
    if (failNext) return Response.json({ error: "boom" }, { status: 500 });
    if (url.includes("path=%2Fsrv%2Ffast")) return Response.json({ path: "/srv/fast", parent: "/srv", entries: [] });
    return Response.json({ path: "/srv/recovered", parent: "/srv", entries: [] });
  };

  const ctrl = createFilesController((s) => states.push(s), { fetcher });
  const slow = ctrl.openDir("/srv/slow");
  await ctrl.openDir("/srv/fast");
  resolveSlowDir(Response.json(listing));
  await slow;
  assert.equal(slowSignal?.aborted, true);
  assert.equal(states.at(-1)?.kind, "ready");
  assert.equal(states.at(-1)?.path, "/srv/fast");

  failNext = true;
  await ctrl.openDir("/srv/recovered");
  assert.equal(states.at(-1)?.kind, "error");
  failNext = false;
  await ctrl.refresh();
  assert.equal(states.at(-1)?.kind, "ready");
  assert.equal(states.at(-1)?.path, "/srv/recovered");

  const beforeDispose = states.length;
  ctrl.dispose();
  await ctrl.openDir("/srv/after-dispose");
  assert.equal(states.length, beforeDispose);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError as MediaApiError, ICON_CATALOG, classifyMediaKind, filterIcons,
  resolveRawMediaUrl, searchStockImages,
} from "../src/lib/media/media-api.ts";
import {
  ApiError as ShellAppApiError, createShellApp, createShellAppsController,
  deleteShellApp, isPlainHttpUrl, isValidAppId, readShellApps,
  type ShellAppSnapshot, type ShellAppsState,
} from "../src/lib/create-app/create-app-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown, status = 200): typeof fetch => async () =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

const sampleSnapshot: ShellAppSnapshot = {
  schemaVersion: 1,
  revision: "rev-1",
  configurable: true,
  apps: [
    {
      id: "grafana", title: "Grafana", description: "Metrics portal",
      origin: "https://grafana.example.com", url: "https://grafana.example.com/",
      renderer: "iframe", sandbox: "allow-scripts allow-same-origin allow-forms",
      definition: { id: "grafana", title: "Grafana", description: "Metrics portal", url: "https://grafana.example.com/", mode: "embed" },
    },
    {
      id: "same-cookie", title: "Blocked App", description: "Shares cookie scope",
      origin: "https://mso.example.com", renderer: "remote", blocked: true,
      reason: "Shares MSO session cookie scope.", sandbox: "allow-scripts allow-same-origin allow-forms",
      definition: { id: "same-cookie", title: "Blocked App", description: "Shares cookie scope", url: "https://mso.example.com/", mode: "tab" },
    },
  ],
};

test("classifyMediaKind classifies image, audio, video, text, and unsupported paths", () => {
  assert.equal(classifyMediaKind("/assets/photo.PNG"), "image");
  assert.equal(classifyMediaKind("~/clips/song.mp3?v=1"), "audio");
  assert.equal(classifyMediaKind("demo/movie.webm#t=5"), "video");
  assert.equal(classifyMediaKind("/docs/readme.md"), "text");
  assert.equal(classifyMediaKind("/bin/archive.tar.gz"), "unsupported");
  assert.equal(classifyMediaKind(""), "unsupported");
  assert.equal(classifyMediaKind(".hidden"), "unsupported");
});

test("resolveRawMediaUrl encodes path, honors bridge origin, and rejects empty paths", () => {
  assert.equal(resolveRawMediaUrl("/tmp/my photo.png"), "/api/v1/fs/raw?path=%2Ftmp%2Fmy%20photo.png");
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  assert.equal(resolveRawMediaUrl("~/a&b.mp3", bridge), "http://127.0.0.1:4173/api/v1/fs/raw?path=~%2Fa%26b.mp3");
  assert.throws(() => resolveRawMediaUrl(""), /required/);
  assert.throws(() => resolveRawMediaUrl("   "), /required/);
});

test("ICON_CATALOG exposes 24 unique semantic icons and filterIcons filters by id, label, and category", () => {
  assert.equal(ICON_CATALOG.length, 24);
  assert.equal(new Set(ICON_CATALOG.map((i) => i.id)).size, 24);
  assert.equal(filterIcons("").length, 24);
  assert.equal(filterIcons("   ").length, 24);
  assert.ok(filterIcons("media").some((i) => i.id === "film"));
  assert.ok(filterIcons("terminal").some((i) => i.id === "terminal"));
  assert.deepEqual(filterIcons("nonexistent-glyph-xyz"), []);
});

test("searchStockImages validates safe http(s) URLs, blocks javascript:/data:, and maps errors", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const res = await searchStockImages("mountain view", 2, signal, async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/v1/stock/search?q=mountain%20view&page=2");
    assert.equal(init?.credentials, "include");
    return Response.json({
      results: [
        { id: "ok-1", thumb: "https://img.example.com/t.jpg", url: "https://img.example.com/f.jpg", title: "Peak", creator: "Ada", license: "CC0" },
        { id: "xss-url", thumb: "https://img.example.com/t.jpg", url: "javascript:alert(1)", title: "Bad", creator: "X", license: "CC0" },
        { id: "xss-thumb", thumb: "javascript:alert(2)", url: "https://img.example.com/f2.jpg", title: "BadThumb", creator: "X", license: "CC0" },
        { id: "data-uri", thumb: "data:text/html,hi", url: "data:image/svg+xml,<svg/>", title: "Data", creator: "X", license: "CC0" },
      ],
    });
  }, bridge);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0]?.id, "ok-1");

  await assert.rejects(searchStockImages("   ", 1, signal, jsonOf({ results: [] })), (e: unknown) => e instanceof MediaApiError && e.status === 400);
  await assert.rejects(searchStockImages("cats", 1, signal, async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })), (e: unknown) => e instanceof MediaApiError && e.status === 502);
  await assert.rejects(searchStockImages("cats", 1, signal, jsonOf({ error: "secret stack trace" }, 502)), (e: unknown) => e instanceof MediaApiError && !e.message.includes("secret stack trace"));
});

test("isValidAppId and isPlainHttpUrl enforce backend contract rules", () => {
  assert.equal(isValidAppId("grafana-1"), true);
  assert.equal(isValidAppId("a"), true);
  assert.equal(isValidAppId(""), false);
  assert.equal(isValidAppId("-leading"), false);
  assert.equal(isValidAppId("Upper"), false);
  assert.equal(isValidAppId("a".repeat(65)), false);

  assert.equal(isPlainHttpUrl("https://app.example.com/portal"), true);
  assert.equal(isPlainHttpUrl("http://127.0.0.1:8080/"), true);
  assert.equal(isPlainHttpUrl("https://user:pass@app.example.com/"), false);
  assert.equal(isPlainHttpUrl("https://app.example.com/?q=1"), false);
  assert.equal(isPlainHttpUrl("https://app.example.com/#sec"), false);
  assert.equal(isPlainHttpUrl("javascript:alert(1)"), false);
  assert.equal(isPlainHttpUrl("https://app.example.com/a\\b"), false);
});

test("readShellApps, createShellApp, and deleteShellApp match ShellAppSnapshot and ShellAppMutation DTOs", async () => {
  const snap = await readShellApps(signal, jsonOf(sampleSnapshot));
  assert.equal(snap.revision, "rev-1");
  assert.equal(snap.apps.length, 2);
  assert.equal(snap.apps[1]?.blocked, true);

  for (const bad of [null, {}, { schemaVersion: 2, revision: "r", configurable: true, apps: [] }]) {
    await assert.rejects(readShellApps(signal, jsonOf(bad)), /shell apps response is invalid/);
  }

  let capturedCreate: Record<string, unknown> | undefined;
  const created = await createShellApp(
    { id: "notes-app", title: "Notes", description: "Team notes", url: "https://notes.example.com/app", mode: "embed" },
    "rev-1", signal,
    async (input, init) => {
      assert.equal(input, "/api/v1/shell-apps");
      assert.equal(init?.method, "POST");
      capturedCreate = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "notes-app", revision: "rev-2", schemaVersion: 1 });
    },
  );
  assert.equal(created.id, "notes-app");
  assert.deepEqual(capturedCreate, {
    schemaVersion: 1, action: "add", expectedRevision: "rev-1", confirm: true,
    app: { id: "notes-app", title: "Notes", description: "Team notes", url: "https://notes.example.com/app", mode: "embed" },
  });

  await assert.rejects(
    createShellApp({ id: "BAD ID", title: "X", description: "", url: "https://a.example/", mode: "embed" }, "rev-1", signal, jsonOf({})),
    (e: unknown) => e instanceof ShellAppApiError && e.status === 400,
  );

  let capturedDelete: Record<string, unknown> | undefined;
  const removed = await deleteShellApp("notes-app", "rev-2", signal, async (_input, init) => {
    capturedDelete = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ id: "notes-app", revision: "rev-3", schemaVersion: 1 });
  });
  assert.equal(removed.id, "notes-app");
  assert.deepEqual(capturedDelete, { schemaVersion: 1, action: "remove", expectedRevision: "rev-2", confirm: true, id: "notes-app" });
});

test("createShellAppsController handles refresh, create, remove, 403 forbidden, and dispose", async () => {
  let currentApps = [...sampleSnapshot.apps];
  let rev = 1;
  const states: ShellAppsState[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { action: string; app?: { id: string; title: string; description: string; url: string; mode: "embed" | "tab" }; id?: string };
      rev++;
      if (body.action === "add" && body.app) {
        currentApps = [...currentApps, {
          id: body.app.id, title: body.app.title, description: body.app.description,
          origin: new URL(body.app.url).origin, url: body.app.url, renderer: "iframe",
          sandbox: "allow-scripts", definition: body.app,
        }];
        return Response.json({ id: body.app.id, revision: `rev-${rev}`, schemaVersion: 1 });
      }
      if (body.action === "remove") {
        currentApps = currentApps.filter((a) => a.id !== body.id);
        return Response.json({ id: body.id, revision: `rev-${rev}`, schemaVersion: 1 });
      }
    }
    return Response.json({ schemaVersion: 1, revision: `rev-${rev}`, configurable: true, apps: currentApps });
  };

  const ctrl = createShellAppsController((s) => states.push(s), fetcher);
  await ctrl.refresh();
  assert.equal(states.at(-1)?.kind, "ready");
  await ctrl.create({ id: "docs-hub", title: "Docs", description: "Hub", url: "https://docs.example.com/", mode: "embed" });
  const afterCreate = states.at(-1);
  assert.equal(afterCreate?.kind, "ready");
  if (afterCreate?.kind === "ready") {
    assert.equal(afterCreate.snapshot.apps.some((a) => a.id === "docs-hub"), true);
    assert.match(afterCreate.notice ?? "", /Registered/);
  }
  await ctrl.remove("docs-hub");
  const afterRemove = states.at(-1);
  assert.equal(afterRemove?.kind, "ready");
  if (afterRemove?.kind === "ready") {
    assert.equal(afterRemove.snapshot.apps.some((a) => a.id === "docs-hub"), false);
    assert.match(afterRemove.notice ?? "", /Removed/);
  }
  ctrl.dispose();

  const errStates: ShellAppsState[] = [];
  const errCtrl = createShellAppsController((s) => errStates.push(s), jsonOf({ error: "owner_required" }, 403));
  await errCtrl.refresh();
  const lastErr = errStates.at(-1);
  assert.equal(lastErr?.kind, "error");
  assert.equal(lastErr?.kind === "error" && lastErr.forbidden, true);
  errCtrl.dispose();
});

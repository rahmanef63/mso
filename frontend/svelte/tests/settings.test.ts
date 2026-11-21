import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, createPrefsController, isSafeQuicklinkUrl, readPrefs, savePrefs,
  type OsPrefs, type PrefsState,
} from "../src/lib/settings/prefs-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown, status = 200): typeof fetch => async () =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

test("isSafeQuicklinkUrl allows only http and https URLs", () => {
  assert.equal(isSafeQuicklinkUrl("https://example.com/docs"), true);
  assert.equal(isSafeQuicklinkUrl("http://127.0.0.1:8080/health?ok=1"), true);
  assert.equal(isSafeQuicklinkUrl("  https://github.com/rahmanef63/mso  "), true);
  for (const bad of ["", "   ", "javascript:alert(1)", "data:text/html,<h1>x</h1>", "file:///etc/passwd", "ftp://example.com", "example.com", "http://", null, 42]) {
    assert.equal(isSafeQuicklinkUrl(bad), false, `expected unsafe: ${String(bad)}`);
  }
});

test("readPrefs validates OsPrefs, strips wallpaperStyle, and filters unsafe quicklinks", async () => {
  const raw = {
    tweaks: { theme: "dark", reducedMotion: true, preset: "nord", wallpaperStyle: { background: "red" } },
    quicklinks: [
      { id: "q1", title: "MSO", url: "https://github.com/rahmanef63/mso" },
      { id: "q2", title: "XSS", url: "javascript:alert(1)" },
      { id: "q3", title: "Data", url: "data:text/html,boom" },
      { id: "", title: "EmptyId", url: "https://example.com" },
    ],
    updates: { auto: true, channel: "stable" },
    updatedAt: 1730000000000,
  };
  const prefs = await readPrefs(signal, async (input, init) => {
    assert.equal(input, "/api/prefs");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return Response.json(raw);
  });
  assert.deepEqual(prefs, {
    tweaks: { theme: "dark", reducedMotion: true, preset: "nord" },
    quicklinks: [{ id: "q1", title: "MSO", url: "https://github.com/rahmanef63/mso" }],
    updates: { auto: true, channel: "stable" },
    updatedAt: 1730000000000,
  });
  assert.deepEqual(await readPrefs(signal, jsonOf({})), {});
});

test("readPrefs fails closed on malformed OsPrefs shapes and HTML fallback", async () => {
  const bad: unknown[] = [
    null, [], "str", { tweaks: [] }, { tweaks: { theme: "neon" } }, { tweaks: { reducedMotion: "yes" } },
    { quicklinks: "bad" }, { updates: { auto: "yes", channel: "main" } }, { updates: { auto: true, channel: "beta" } }, { updatedAt: -1 },
  ];
  for (const payload of bad) {
    await assert.rejects(readPrefs(signal, jsonOf(payload)), (e: unknown) => e instanceof ApiError && e.status === 502);
  }
  await assert.rejects(
    readPrefs(signal, async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })),
    (e: unknown) => e instanceof ApiError && e.status === 502 && /API is unavailable/.test(e.message),
  );
});

test("savePrefs strips wallpaperStyle, enforces safe URLs, and maps 401/403 without leaks", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  let sentBody: Record<string, unknown> | null = null;
  await savePrefs({ tweaks: { theme: "light", reducedMotion: false, wallpaperStyle: { background: "none" } } }, signal, async (input, init) => {
    assert.equal(input, "http://127.0.0.1:4173/api/prefs");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "include");
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ ok: true });
  }, bridge);
  assert.deepEqual(sentBody, { tweaks: { theme: "light", reducedMotion: false } });
  await assert.rejects(
    savePrefs({ quicklinks: [{ id: "bad", title: "X", url: "javascript:void(0)" }] }, signal, jsonOf({ ok: true })),
    (e: unknown) => e instanceof ApiError && e.status === 400,
  );
  await assert.rejects(savePrefs({}, signal, jsonOf({ ok: true })), (e: unknown) => e instanceof ApiError && e.status === 400);
  for (const status of [401, 403]) {
    await assert.rejects(
      savePrefs({ tweaks: { theme: "dark" } }, signal, jsonOf({ error: "internal owner secret" }, status)),
      (e: unknown) => e instanceof ApiError && e.status === status
        && e.message === "Owner role is required to update shared workspace preferences."
        && !e.message.includes("internal owner secret"),
    );
  }
});

test("controller handles saveTweaks, add/remove quicklinks, and dispose race safety", async () => {
  const initial: OsPrefs = { tweaks: { theme: "light", preset: "stock" }, quicklinks: [{ id: "q1", title: "Example", url: "https://example.com" }] };
  const states: PrefsState[] = [];
  const posted: Array<Record<string, unknown>> = [];
  let resolveSlow!: (res: Response) => void;
  let slowSignal: AbortSignal | null | undefined;
  let calls = 0;

  const ctrl = createPrefsController((s) => states.push(s), async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json(initial);
    if (init?.method === "POST") { posted.push(JSON.parse(String(init.body)) as Record<string, unknown>); return Response.json({ ok: true }); }
    slowSignal = init?.signal;
    return new Promise<Response>((r) => { resolveSlow = r; });
  });

  await ctrl.refresh();
  assert.equal(await ctrl.saveTweaks({ theme: "dark", reducedMotion: true }), true);
  assert.deepEqual(posted[0], { tweaks: { theme: "dark", preset: "stock", reducedMotion: true } });
  assert.equal(await ctrl.addQuicklink("Bad", "javascript:alert(1)"), false);
  assert.equal(posted.length, 1);
  assert.equal(await ctrl.addQuicklink("Docs", "https://docs.example.com"), true);
  assert.equal(posted.length, 2);
  const afterAdd = states.at(-1);
  assert.equal(afterAdd?.kind, "ready");
  assert.equal(afterAdd.prefs.quicklinks?.length, 2);
  assert.equal(await ctrl.removeQuicklink("q1"), true);
  const afterRemove = states.at(-1);
  assert.equal(afterRemove?.kind, "ready");
  assert.equal(afterRemove.prefs.quicklinks?.length, 1);
  assert.equal(afterRemove.prefs.quicklinks?.[0]?.title, "Docs");
  const late = ctrl.refresh();
  ctrl.dispose();
  resolveSlow(Response.json(initial));
  await late;
  await ctrl.refresh();
  assert.equal(slowSignal?.aborted, true);
  assert.equal(calls, 5);
  assert.equal(states.at(-1)?.kind, "loading");
});

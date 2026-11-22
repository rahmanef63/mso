import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  changeCockpitPassword,
  createAccountController,
  readAccountProfile,
  updateAccountProfile,
  validateNewPassword,
  type AccountProfile,
  type AccountState,
} from "../src/lib/auth/account-api.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown, status = 200): typeof fetch => async () =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);
const sampleProfile: AccountProfile = { name: "Owner", icon: { type: "preset", id: "user" } };

test("validateNewPassword matches backend policy and never echoes secrets", () => {
  assert.equal(validateNewPassword("abc123"), null);
  assert.equal(validateNewPassword("Strong!@%^*_+-=.,:?~99"), null);
  assert.equal(validateNewPassword("a".repeat(128)), null);

  for (const bad of ["", "12345", "a".repeat(129), "has space1", "has$dollar", "has\"quote", "has'single", "semi;colon"]) {
    const err = validateNewPassword(bad);
    assert.equal(typeof err, "string", `expected rejection for length ${bad.length}`);
    assert.ok(err && err.length > 0);
    if (bad.length >= 4) assert.equal(err.includes(bad), false, "error must never echo raw password");
  }
});

test("readAccountProfile validates preset, library, and image profiles and fails closed on bad payloads", async () => {
  const bridge = { surface: "rust-host" as const, apiBaseOrigin: "http://127.0.0.1:4173" };
  const got = await readAccountProfile(signal, async (url, init) => {
    assert.equal(url, "http://127.0.0.1:4173/api/auth/account");
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    return Response.json({ name: "Rahman", icon: { type: "library", value: "lucide:Shield?c=0b6e99" } });
  }, bridge);
  assert.deepEqual(got, { name: "Rahman", icon: { type: "library", value: "lucide:Shield?c=0b6e99" } });

  const imgProfile: AccountProfile = { name: "Ops", icon: { type: "image", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" } };
  assert.deepEqual(await readAccountProfile(signal, jsonOf(imgProfile)), imgProfile);

  const badPayloads: unknown[] = [
    null, [], "Owner", {}, { name: "", icon: sampleProfile.icon }, { name: "a".repeat(41), icon: sampleProfile.icon },
    { name: "Bad\u0007Name", icon: sampleProfile.icon }, { name: "Owner", icon: { type: "preset", id: "unknown" } },
    { name: "Owner", icon: { type: "library", value: "bad:icon" } }, { name: "Owner", icon: { type: "image", src: "https://evil.example/a.png" } },
  ];
  for (const payload of badPayloads) {
    await assert.rejects(readAccountProfile(signal, jsonOf(payload)), (e: unknown) => e instanceof ApiError && e.status === 502);
  }
  await assert.rejects(
    readAccountProfile(signal, async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })),
    (e: unknown) => e instanceof ApiError && e.status === 502 && /API is unavailable/.test(e.message),
  );
  await assert.rejects(
    readAccountProfile(signal, async () => new Response("{broken", { headers: { "Content-Type": "application/json" } })),
    (e: unknown) => e instanceof ApiError && e.status === 502,
  );
});

test("updateAccountProfile validates input and maps 401/403/429/400 without leaking server bodies", async () => {
  let sent: Record<string, unknown> | null = null;
  const updated = await updateAccountProfile({ name: "  Rahman   Host  " }, signal, async (url, init) => {
    assert.equal(url, "/api/auth/account");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "same-origin");
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ name: "Rahman Host", icon: { type: "preset", id: "shield" } });
  });
  assert.deepEqual(sent, { name: "Rahman Host" });
  assert.deepEqual(updated, { name: "Rahman Host", icon: { type: "preset", id: "shield" } });

  await assert.rejects(updateAccountProfile({}, signal, jsonOf(sampleProfile)), (e: unknown) => e instanceof ApiError && e.status === 400);
  await assert.rejects(updateAccountProfile({ name: "   " }, signal, jsonOf(sampleProfile)), (e: unknown) => e instanceof ApiError && e.status === 400);
  await assert.rejects(updateAccountProfile({ name: "a".repeat(41) }, signal, jsonOf(sampleProfile)), (e: unknown) => e instanceof ApiError && e.status === 400);

  for (const status of [400, 401, 403, 429]) {
    await assert.rejects(
      updateAccountProfile({ name: "Valid" }, signal, jsonOf({ error: "secret_backend_detail" }, status)),
      (e: unknown) => e instanceof ApiError && e.status === status && !e.message.includes("secret_backend_detail"),
    );
  }
  await assert.rejects(
    updateAccountProfile({ name: "Valid" }, signal, jsonOf({ error: "demo" }, 403)),
    (e: unknown) => e instanceof ApiError && e.status === 403 && /demo mode/i.test(e.message),
  );
});

test("changeCockpitPassword posts backend DTO and maps errors safely without leaking secrets", async () => {
  const posted: Array<Record<string, unknown>> = [];
  await changeCockpitPassword({ currentPassword: "OldPass1!", newPassword: "NewPass2!" }, signal, async (url, init) => {
    assert.equal(url, "/api/auth/password");
    assert.equal(init?.method, "POST");
    posted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ ok: true });
  });
  assert.deepEqual(posted[0], { currentPassword: "OldPass1!", newPassword: "NewPass2!", confirmPassword: "NewPass2!" });

  await assert.rejects(
    changeCockpitPassword({ currentPassword: "", newPassword: "NewPass2!" }, signal, jsonOf({ ok: true })),
    (e: unknown) => e instanceof ApiError && e.status === 400 && !e.message.includes("NewPass2!"),
  );
  await assert.rejects(
    changeCockpitPassword({ currentPassword: "OldPass1!", newPassword: "short" }, signal, jsonOf({ ok: true })),
    (e: unknown) => e instanceof ApiError && e.status === 400 && !e.message.includes("short"),
  );
  await assert.rejects(
    changeCockpitPassword({ currentPassword: "OldPass1!", newPassword: "NewPass2!", confirmPassword: "OtherPass3!" }, signal, jsonOf({ ok: true })),
    (e: unknown) => e instanceof ApiError && e.status === 400 && /do not match/i.test(e.message) && !e.message.includes("NewPass2!"),
  );
  await assert.rejects(
    changeCockpitPassword({ currentPassword: "SamePass1!", newPassword: "SamePass1!" }, signal, jsonOf({ ok: true })),
    (e: unknown) => e instanceof ApiError && e.status === 400 && /different/i.test(e.message) && !e.message.includes("SamePass1!"),
  );

  const errorCases: Array<[number, string, RegExp]> = [
    [401, "bad_current", /Current password is incorrect/],
    [403, "owner_required", /Owner role is required/],
    [403, "demo", /demo mode/i],
    [429, "rate_limited", /Too many password attempts/],
    [400, "weak_password", /6 to 128/],
    [400, "raw_secret_leak_xyz", /rejected/i],
    [409, "password_source_mismatch", /\.env\.local/],
  ];
  for (const [status, code, pattern] of errorCases) {
    await assert.rejects(
      changeCockpitPassword({ currentPassword: "OldPass1!", newPassword: "NewPass2!" }, signal, jsonOf({ error: code }, status)),
      (e: unknown) => e instanceof ApiError && e.status === status && pattern.test(e.message)
        && !e.message.includes("raw_secret_leak_xyz") && !e.message.includes("OldPass1!") && !e.message.includes("NewPass2!"),
    );
  }
  await assert.rejects(
    changeCockpitPassword({ currentPassword: "OldPass1!", newPassword: "NewPass2!" }, signal, async () => new Response("<html>500</html>", { status: 500, headers: { "Content-Type": "text/html" } })),
    (e: unknown) => e instanceof ApiError && e.status === 500 && !e.message.includes("<html>"),
  );
  await assert.rejects(
    changeCockpitPassword({ currentPassword: "OldPass1!", newPassword: "NewPass2!" }, signal, jsonOf({ ok: false })),
    (e: unknown) => e instanceof ApiError && e.status === 502,
  );
});

test("createAccountController handles refresh, display name update, password rotation, and dispose", async () => {
  const states: AccountState[] = [];
  let resolveSlow!: (res: Response) => void;
  let slowSignal: AbortSignal | null | undefined;
  let calls = 0;

  const ctrl = createAccountController((s) => states.push(s), async (url, init) => {
    calls++;
    if (calls === 1) return Response.json(sampleProfile);
    if (url === "/api/auth/account" && init?.method === "POST") {
      return Response.json({ name: "Rahman Studio", icon: sampleProfile.icon });
    }
    if (url === "/api/auth/password" && init?.method === "POST") {
      return calls === 3 ? Response.json({ error: "bad_current" }, { status: 401 }) : Response.json({ ok: true });
    }
    slowSignal = init?.signal;
    return new Promise<Response>((r) => { resolveSlow = r; });
  });

  await ctrl.refresh();
  const ready = states.at(-1);
  assert.equal(ready?.kind, "ready");
  assert.equal(ready.profile.name, "Owner");

  assert.equal(await ctrl.saveDisplayName("Rahman Studio"), true);
  const renamed = states.at(-1);
  assert.equal(renamed?.kind, "ready");
  assert.equal(renamed.profile.name, "Rahman Studio");
  assert.equal(renamed.notice, "Account display name updated.");

  assert.equal(await ctrl.rotatePassword({ currentPassword: "Wrong1!", newPassword: "NewPass2!" }), false);
  const failedRot = states.at(-1);
  assert.equal(failedRot?.kind, "ready");
  assert.equal(failedRot.passwordRotated, false);
  assert.equal(failedRot.actionError, "Current password is incorrect.");

  assert.equal(await ctrl.rotatePassword({ currentPassword: "OldPass1!", newPassword: "NewPass2!", confirmPassword: "NewPass2!" }), true);
  const rotated = states.at(-1);
  assert.equal(rotated?.kind, "ready");
  assert.equal(rotated.passwordRotated, true);
  assert.ok(rotated.notice && !rotated.notice.includes("NewPass2!"));

  const late = ctrl.refresh();
  ctrl.dispose();
  resolveSlow(Response.json(sampleProfile));
  await late;
  await ctrl.refresh();
  assert.equal(slowSignal?.aborted, true);
  assert.equal(calls, 5);
  assert.equal(states.at(-1)?.kind, "loading");
});

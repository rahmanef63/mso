import { test } from "node:test";
import assert from "node:assert/strict";
import { loginWithPassword, logoutSession, mutateDevice, readDevices, ApiError } from "../src/lib/host-api.ts";
import { createDevicesController, type DevicesState } from "../src/lib/devices-controller.ts";
import { detectDeviceLabel } from "../src/lib/device.ts";

const signal = new AbortController().signal;
const sampleInventory = {
  approved: {
    "aaaaaaaaaaaaaaaa": { label: "Owner Laptop", approvedAt: 1_700_000_000_000, role: "owner" as const },
  },
  pending: {
    "bbbbbbbbbbbbbbbb": { label: "Phone Browser", firstSeen: 1_700_000_001_000, lastSeen: 1_700_000_002_000, ip: "127.0.0.1", attempts: 1 },
  },
};

test("loginWithPassword handles ok, pending, bad-password, rate-limited, demo-disabled and CSRF 403", async () => {
  const input = { password: "secret", deviceId: "aaaaaaaaaaaaaaaa", deviceLabel: "Chrome · Linux" };

  assert.deepEqual(
    await loginWithPassword(input, signal, async () => Response.json({ success: true })),
    { kind: "ok" },
  );
  assert.deepEqual(
    await loginWithPassword(input, signal, async () => Response.json({ error: "device_pending", deviceId: "aaaaaaaaaaaaaaaa", label: "Chrome · Linux" }, { status: 403 })),
    { kind: "pending", deviceId: "aaaaaaaaaaaaaaaa", label: "Chrome · Linux" },
  );
  assert.deepEqual(
    await loginWithPassword(input, signal, async () => Response.json({ error: "bad_password" }, { status: 401 })),
    { kind: "bad-password" },
  );
  assert.deepEqual(
    await loginWithPassword(input, signal, async () => Response.json({ error: "Too many" }, { status: 429 })),
    { kind: "rate-limited" },
  );
  assert.deepEqual(
    await loginWithPassword(input, signal, async () => Response.json({ error: "login_disabled_in_demo" }, { status: 403 })),
    { kind: "demo-disabled" },
  );
  const csrf = await loginWithPassword(input, signal, async () => Response.json({ error: "cross_origin_blocked" }, { status: 403 }));
  assert.equal(csrf.kind, "error");
});

test("logoutSession posts to /api/auth/logout and rejects failures", async () => {
  let called = "";
  await logoutSession(signal, async (url, init) => {
    called = `${init?.method} ${url}`;
    return Response.json({ success: true });
  });
  assert.equal(called, "POST /api/auth/logout");
  await assert.rejects(
    logoutSession(signal, async () => Response.json({ error: "fail" }, { status: 500 })),
    (err: unknown) => err instanceof ApiError && err.status === 500,
  );
});

test("readDevices validates inventory and fails closed on malformed payloads", async () => {
  assert.deepEqual(await readDevices(signal, async () => Response.json(sampleInventory)), sampleInventory);
  for (const bad of [null, {}, { approved: {}, pending: { x: { label: 123 } } }, { approved: { x: { label: "a", approvedAt: 1, role: "root" } }, pending: {} }]) {
    await assert.rejects(readDevices(signal, async () => Response.json(bad)), /devices response is invalid/);
  }
});

test("mutateDevice maps 403/409/503 cleanly without leaking server bodies", async () => {
  for (const status of [403, 409, 503]) {
    await assert.rejects(
      mutateDevice({ action: "revoke", deviceId: "aaaaaaaaaaaaaaaa" }, signal, async () => Response.json({ error: "secret detail" }, { status })),
      (err: unknown) => err instanceof ApiError && err.status === status && !err.message.includes("secret detail"),
    );
  }
});

test("createDevicesController refreshes, approves pending device, and stops on dispose", async () => {
  const states: DevicesState[] = [];
  const afterApprove = {
    approved: {
      ...sampleInventory.approved,
      "bbbbbbbbbbbbbbbb": { label: "Phone Browser", approvedAt: 1_700_000_005_000, role: "operator" as const },
    },
    pending: {},
  };
  const ctrl = createDevicesController((s) => states.push(s), async (url, init) => {
    if (init?.method === "POST") return Response.json({ ok: true, ...afterApprove });
    assert.equal(url, "/api/auth/devices");
    return Response.json(sampleInventory);
  });
  await ctrl.refresh();
  assert.equal(states.at(-1)?.kind, "ready");
  await ctrl.approve("bbbbbbbbbbbbbbbb", "Phone Browser", "operator");
  const last = states.at(-1);
  assert.equal(last?.kind, "ready");
  if (last?.kind === "ready") {
    assert.equal(last.notice, "Device approved.");
    assert.equal(Object.keys(last.inventory.pending).length, 0);
    assert.equal(last.inventory.approved["bbbbbbbbbbbbbbbb"]?.role, "operator");
  }
  ctrl.dispose();
  const count = states.length;
  await ctrl.refresh();
  assert.equal(states.length, count);
});

test("detectDeviceLabel parses OS and browser names cleanly", () => {
  assert.equal(detectDeviceLabel("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0"), "Chrome · Linux");
  assert.equal(detectDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/131.0"), "Firefox · macOS");
  assert.equal(detectDeviceLabel(""), "Unknown device");
});

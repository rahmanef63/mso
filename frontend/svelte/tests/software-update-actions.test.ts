import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, requestSoftwareUpdate, type SoftwareUpdateStatus } from "../src/lib/settings/host-ops-api.ts";
import { finishedSoftwareUpdate } from "../src/lib/settings/update-outcome.ts";

const signal = new AbortController().signal;
const jsonOf = (body: unknown, status = 200): typeof fetch => async () => Response.json(body, { status });
const sampleUpdate: SoftwareUpdateStatus = {
  supported: true, reason: null, current: "abc1234", currentSubject: "feat: hybrid shell",
  latest: "def5678", buildSha: "abc1234", pendingBuild: false, ahead: 0, behind: 2,
  commits: [], dirty: false, running: false, remoteChecked: true, log: "", channel: "stable",
};

test("manual update sends only the intended operation and validates the server response", async () => {
  for (const [action, body] of [
    ["check", { action: "check" }], ["update", { rebuildOnly: false }], ["rebuild", { rebuildOnly: true }],
  ] as const) {
    const state = await requestSoftwareUpdate(action, signal, async (input, init) => {
      assert.equal(String(input), "/api/v1/sys/update");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "same-origin");
      assert.deepEqual(JSON.parse(String(init?.body)), body);
      return Response.json(sampleUpdate);
    });
    assert.deepEqual(state, sampleUpdate);
  }
  await assert.rejects(requestSoftwareUpdate("update", signal, jsonOf({ error: "checkout not clean" }, 400)),
    (e: unknown) => e instanceof ApiError && e.status === 400 && e.message === "checkout not clean");
  await assert.rejects(requestSoftwareUpdate("rebuild", signal, jsonOf({ malformed: true })),
    (e: unknown) => e instanceof ApiError && e.status === 502);
});

test("a stale success log or stale running build cannot grade a fresh update", () => {
  const initial = "old attempt\nUPDATE OK";
  assert.equal(finishedSoftwareUpdate({ ...sampleUpdate, log: initial }, initial), false);
  assert.equal(finishedSoftwareUpdate({ ...sampleUpdate, log: initial + "\nUPDATE FAILED" }, initial), false);
  assert.equal(finishedSoftwareUpdate({ ...sampleUpdate, log: initial + "\nnew attempt but no result" }, initial), false);
  const accepted = { ...sampleUpdate, log: "new attempt\nUPDATE OK" };
  assert.equal(finishedSoftwareUpdate({ ...accepted, pendingBuild: true }, initial), false);
  assert.equal(finishedSoftwareUpdate({ ...accepted, running: true }, initial), false);
  assert.equal(finishedSoftwareUpdate(accepted, initial), true);
});

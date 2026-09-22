import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createChannel, readChannelState, recordChannelActivity, recordChannelCheck, updateChannel } from "./store";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mso-channels-"));
  process.env.OS_CHANNEL_STORE = path.join(dir, "channels.json");
});
afterEach(async () => {
  delete process.env.OS_CHANNEL_STORE;
  await rm(dir, { recursive: true, force: true });
});

describe("channel store", () => {
  it("persists non-secret config and keeps activity/check telemetry outside config revision", async () => {
    const created = await createChannel({
      name: "Bot",
      provider: "telegram",
      credential: { user: "owner", connection: "telegram" },
      enabled: true,
      defaultTarget: "-100123",
    });
    expect(created.state.revision).toBe(1);
    const id = created.result.id;

    await recordChannelActivity(id);
    await recordChannelCheck(id, true, "verified");
    const observed = await readChannelState();
    expect(observed.revision).toBe(1);
    expect(observed.channels[0]?.lastCheck?.ok).toBe(true);
    expect(observed.channels[0]?.lastActivityAt).toBeTruthy();

    const updated = await updateChannel(id, observed.revision, { enabled: false });
    expect(updated.state.revision).toBe(2);
    expect(updated.result.enabled).toBe(false);
  });
});

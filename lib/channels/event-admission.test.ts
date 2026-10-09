import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { admitChannelEvent } from "./event-admission";
let home: string;
afterEach(async () => { vi.restoreAllMocks(); if (home) await fs.rm(home, { recursive: true, force: true }); });
it("atomically admits one replayed event before any durable session allocation", async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mso-channel-admit-")); vi.spyOn(os, "homedir").mockReturnValue(home);
  const attempts = await Promise.all([admitChannelEvent("one", "event"), admitChannelEvent("one", "event"), admitChannelEvent("one", "event")]);
  expect(attempts.filter(Boolean)).toHaveLength(1);
  vi.resetModules(); const reloaded = await import("./event-admission"); expect(await reloaded.admitChannelEvent("one", "event")).toBe(false);
  expect(await reloaded.admitChannelEvent("two", "event")).toBe(true);
  expect((await fs.stat(path.join(home, ".mso/private/channel-events.json"))).mode & 0o777).toBe(0o600);
});

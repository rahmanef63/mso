import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopAction, isPermissionError, isRunning, listDesktops, PermissionError, screenshotUrl, SCREENS, type BotDesktop } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

const sample: BotDesktop = {
  id: "abc123456789",
  name: "grokbot-desktop-1",
  state: "running",
  status: "Up 10 minutes",
  labels: { user: "rahman", bot: "manef" },
  created: "2026-11-20T00:00:00Z",
  ports: "",
};

describe("bot-desktops api client", () => {
  it("lists containers and maps 401/403 to PermissionError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ containers: [sample] }), { status: 200 })));
    expect(await listDesktops()).toEqual([sample]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(listDesktops()).rejects.toBeInstanceOf(PermissionError);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    try {
      await listDesktops();
      expect.unreachable("expected 403 to throw");
    } catch (err) {
      expect(isPermissionError(err)).toBe(true);
    }
  });

  it("posts lifecycle actions and formats screenshot URLs safely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ action: "restart", container: sample.name, state: sample }), { status: 200 }),
    ));
    const res = await desktopAction(sample.name, "restart");
    expect(res.action).toBe("restart");
    expect(screenshotUrl("box-1", "99", 0)).toBe("/api/v1/desktop/screenshot?container=box-1&screen=99");
    expect(screenshotUrl("box-1", "1", 42)).toBe("/api/v1/desktop/screenshot?container=box-1&screen=1&t=42");
    expect(SCREENS).toEqual(["99", "1", "2", "3"]);
    expect(isRunning(sample)).toBe(true);
    expect(isRunning({ ...sample, state: "exited" })).toBe(false);
  });
});

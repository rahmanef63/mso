import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async () => true),
  readPrefs: vi.fn(async () => ({ quicklinks: [] })),
  writePrefs: vi.fn(async () => ({ quicklinks: [], updatedAt: 1 })),
}));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/prefs/store", () => ({ readPrefs: mocks.readPrefs, writePrefs: mocks.writePrefs }));

beforeEach(() => {
  mocks.requireSession.mockReset().mockResolvedValue(true);
  mocks.readPrefs.mockClear();
  mocks.writePrefs.mockClear();
});

describe("shared preferences role boundary", () => {
  it("allows any approved device to read the deployment preferences", async () => {
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(200);
    expect(mocks.requireSession).toHaveBeenCalledWith();
    expect(mocks.readPrefs).toHaveBeenCalledOnce();
  });

  it("requires Owner before changing cross-device preferences", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("https://mso.example/api/prefs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ quicklinks: [] }),
    });
    expect((await POST(request)).status).toBe(200);
    expect(mocks.requireSession).toHaveBeenCalledWith("owner");
    expect(mocks.writePrefs).toHaveBeenCalledWith({ quicklinks: [] });
  });

  it("does not parse or persist a delegated device's mutation", async () => {
    mocks.requireSession.mockResolvedValue(false);
    const { POST } = await import("./route");
    const request = new NextRequest("https://mso.example/api/prefs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ quicklinks: [{ id: "x" }] }),
    });
    expect((await POST(request)).status).toBe(401);
    expect(mocks.writePrefs).not.toHaveBeenCalled();
  });
});

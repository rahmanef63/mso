import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedAppView } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("./manager", () => ({ getManagedApp: vi.fn() }));
vi.mock("./jobs", () => ({ startManagedAppJob: vi.fn() }));
vi.mock("./docker", () => ({ dockerUsable: vi.fn() }));
vi.mock("./user-bus", () => ({ userBusUnavailable: vi.fn() }));

import { dockerUsable } from "./docker";
import { startInstall } from "./install";
import { startManagedAppJob } from "./jobs";
import { getManagedApp } from "./manager";
import { userBusUnavailable } from "./user-bus";

beforeEach(() => {
  vi.mocked(getManagedApp).mockResolvedValue({ installed: false, diagnostic: null } as ManagedAppView);
  vi.mocked(startManagedAppJob).mockReset().mockResolvedValue({} as never);
  vi.mocked(dockerUsable).mockResolvedValue(true);
  vi.mocked(userBusUnavailable).mockReturnValue(false);
});

describe("managed app host preflight", () => {
  it("rejects OpenClaw before starting a job without a user systemd bus", async () => {
    vi.mocked(userBusUnavailable).mockReturnValue(true);
    await expect(startInstall("openclaw")).rejects.toThrow(/user systemd bus/);
    expect(startManagedAppJob).not.toHaveBeenCalled();
  });

  it("allows Hermes Docker fallback without a user systemd bus", async () => {
    vi.mocked(userBusUnavailable).mockReturnValue(true);
    await startInstall("hermes");
    expect(vi.mocked(startManagedAppJob).mock.calls[0]?.[0].applicationId).toBe("hermes");
  });

  it("rejects 9Router before starting a job without Docker", async () => {
    vi.mocked(dockerUsable).mockResolvedValue(false);
    await expect(startInstall("9router")).rejects.toThrow(/Docker daemon/);
    expect(startManagedAppJob).not.toHaveBeenCalled();
  });
});

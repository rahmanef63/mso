import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./manager", () => ({ listManagedApps: vi.fn() }));
vi.mock("./docker", () => ({ dockerUsable: vi.fn(), runDocker: vi.fn() }));

import { dockerUsable, runDocker } from "./docker";
import { discoverLocalApps } from "./local-discovery";
import { listManagedApps } from "./manager";
import type { ManagedAppView } from "./types";

const fakeView = (id: ManagedAppView["id"], installed: boolean, state: ManagedAppView["state"]): ManagedAppView => ({
  id,
  name: id === "n8n" ? "n8n" : id,
  description: "test",
  installed,
  installationType: installed ? "docker" : "not-installed",
  state,
  healthy: installed && state === "running",
  version: null,
  dashboardAvailable: installed && state === "running",
  publicDashboardUrl: null,
  diagnostic: null,
  supportedActions: [],
});

describe("discoverLocalApps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
  });

  it("classifies foreign Docker n8n container as detected-local without claiming MSO ownership", async () => {
    vi.mocked(listManagedApps).mockResolvedValue([
      fakeView("hermes", false, "not-installed"),
      fakeView("openclaw", false, "not-installed"),
      fakeView("9router", false, "not-installed"),
      fakeView("orca", true, "running"),
      fakeView("t3", true, "stopped"),
      fakeView("n8n", false, "not-installed"),
    ]);
    vi.mocked(dockerUsable).mockResolvedValue(true);
    vi.mocked(runDocker).mockResolvedValue({
      code: 0,
      stdout: "dokploy-n8n-prod\tdocker.n8n.io/n8nio/n8n:1.90.0\trunning\t127.0.0.1:5679->5678/tcp\n",
      stderr: "",
    });

    const snapshot = await discoverLocalApps();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.dockerAvailable).toBe(true);

    const n8n = snapshot.apps.find((a) => a.id === "n8n");
    expect(n8n).toMatchObject({
      ownership: "detected-local",
      running: true,
      source: "docker",
      containerName: "dokploy-n8n-prod",
      detectedEndpoint: "http://127.0.0.1:5679",
      recommendedAction: "connect",
    });

    const orca = snapshot.apps.find((a) => a.id === "orca");
    expect(orca).toMatchObject({ ownership: "mso-managed", recommendedAction: "open" });

    const t3 = snapshot.apps.find((a) => a.id === "t3");
    expect(t3).toMatchObject({ ownership: "mso-managed", recommendedAction: "start" });
  });
});

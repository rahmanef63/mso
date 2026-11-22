import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: vi.fn() }));
vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));
vi.mock("@/lib/managed-apps/appdeck-preflight", () => ({ runAppDeckPreflight: vi.fn() }));

import { verifyAuth } from "@/lib/agent/server";
import { runAppDeckPreflight } from "@/lib/managed-apps/appdeck-preflight";
import { handleGetManagedAppPreflight } from "./handler";

const req = () => new Request("http://127.0.0.1:4005/api/v1/managed-apps/n8n/preflight");

beforeEach(() => {
  vi.mocked(verifyAuth).mockResolvedValue(true);
  vi.mocked(runAppDeckPreflight).mockResolvedValue({
    appId: "n8n",
    appName: "n8n",
    installed: false,
    ready: true,
    summary: "n8n is ready for 1-click setup via AppDeck.",
    backend: "docker",
    checks: [{ id: "runtime", label: "Host runtime", status: "pass", detail: "Docker engine is ready." }],
    checkedAt: "2026-11-22T00:00:00.000Z",
  });
});

describe("GET /api/v1/managed-apps/[id]/preflight", () => {
  it("returns 401 when unauthenticated and 404 for unknown app ids", async () => {
    vi.mocked(verifyAuth).mockResolvedValueOnce(false);
    expect((await handleGetManagedAppPreflight(req(), "n8n")).status).toBe(401);
    expect((await handleGetManagedAppPreflight(req(), "unknown-app")).status).toBe(404);
  });

  it("returns the structured AppDeck preflight report for valid managed apps", async () => {
    const res = await handleGetManagedAppPreflight(req(), "n8n");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { appId: string; ready: boolean; checks: unknown[] };
    expect(body.appId).toBe("n8n");
    expect(body.ready).toBe(true);
    expect(body.checks).toHaveLength(1);
  });
});

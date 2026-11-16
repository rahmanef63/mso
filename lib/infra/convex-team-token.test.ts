import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));

const TOKEN = "synthetic_team_access_token_do_not_use_123456789";
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-team-token-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.OS_INFRA_STORE;
  vi.unstubAllGlobals();
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});

describe("Convex team-scoped Management API credentials", () => {
  it("offers a dedicated team token method and retains legacy personal method", async () => {
    const { setupMethod, setupFields, setupMethods } = await import("./setup-guidance");
    expect(setupMethod("convex")).toBe("team");
    expect(setupMethods("convex").map((method) => method.id)).toEqual(["team", "deployment", "admin", "personal"]);
    expect(setupFields("convex", "team").map((field) => field.key)).toEqual(["teamToken"]);
    expect(setupFields("convex", "personal").map((field) => field.key)).toEqual(["personalToken"]);
  });

  it("verifies the team token using token_details and never the PAT-only token list", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 1, type: "teamToken", teamId: 41 }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { doctorConvex } = await import("./convex-doctor");
    const summary = await doctorConvex({ teamToken: TOKEN });
    expect(summary).toContain("team access token authenticated");
    expect(summary).not.toContain(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.convex.dev/v1/token_details");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer " + TOKEN);
  });

  it("rejects a non-team credential entered into the team field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "personalToken" }), { status: 200 })
    ));
    const { doctorConvex } = await import("./convex-doctor");
    await expect(doctorConvex({ teamToken: TOKEN })).rejects.toThrow("did not identify a team access token");
  });

  it.each([401, 403])("preserves HTTP %s for denial without exposing the token", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status })));
    const { doctorConvex } = await import("./convex-doctor");
    await expect(doctorConvex({ teamToken: TOKEN })).rejects.toThrow("Convex Cloud HTTP " + status);
  });

  it("stores team credentials separately and uses them in Management API operations", async () => {
    const { integrationManage } = await import("./connection-manage");
    const { withIntegrationSelection, credentialSnapshot, saveConnectionValues, integrationSnapshot } = await import("./connection-service");
    const { convexCloudManagementToken } = await import("./convex-cloud-key");
    await integrationManage({ action: "user.create", user: "alice", confirm: true });
    await integrationManage({ action: "connection.create", user: "alice", provider: "convex", connection: "team-a", authMethod: "team", source: "direct", confirm: true });
    const selected = { user: "alice", connection: "team-a" };
    const snapshot = await credentialSnapshot("convex", selected);
    await saveConnectionValues("convex", selected, { teamToken: TOKEN }, snapshot.connection, true);
    const resolved = await withIntegrationSelection(selected, () => convexCloudManagementToken());
    expect(resolved).toBe(TOKEN);
    const safe = await integrationSnapshot({ user: "alice" });
    expect(JSON.stringify(safe)).not.toContain(TOKEN);
    expect(safe.connections.find((item) => item.id === "team-a")?.fields.find((field) => field.key === "teamToken")?.stored).toBe(true);
  });
});

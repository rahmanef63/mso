import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Acceptance criterion 2: a pre-existing `convex-cloud` connection survives the
 * provider collapse with its secret still usable and the operator re-entering
 * nothing. Every assertion below is about behaviour — the migration never prints,
 * returns, or re-encrypts a credential value.
 */

const PAT = "pat_synthetic_migration_1234567890";
const DEPLOY_KEY = "prod:happy-otter-123|synthetic_migration_key_123456";
const ADMIN_KEY = "synthetic_self_hosted_admin_key_123456";
let root = "", file = "", original = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-migrate-"));
  file = path.join(root, "infra.json");
  process.env.OS_INFRA_STORE = file;
  vi.resetModules();
  // A store written BEFORE the collapse: connections still live under
  // "convex-cloud", and the file carries no `deploymentKind` anywhere.
  original = JSON.stringify({
    version: 2,
    instanceId: "synthetic-instance",
    defaultUser: "alice",
    users: {
      alice: {
        id: "alice", uid: "alice-uid", label: "Alice",
        defaults: { "convex-cloud": "admin" },
        connections: {
          "convex-cloud": {
            admin: {
              id: "admin", uid: "uid-admin", label: "Admin", provider: "convex-cloud", source: "direct",
              authMethod: "personal", scope: "account", revision: 3, values: { personalToken: PAT },
              createdAt: 10, updatedAt: 20, verifiedAt: 30,
            },
            prod: {
              id: "prod", uid: "uid-prod", label: "Prod", provider: "convex-cloud", source: "direct",
              authMethod: "deployment", scope: "deployment", revision: 1,
              values: { deployKey: DEPLOY_KEY, deploymentName: "happy-otter-123" },
              createdAt: 11, updatedAt: 21, lastCheck: { revision: 1, checkedAt: 40, result: "verified" },
            },
          },
        },
      },
      bob: {
        id: "bob", uid: "bob-uid", label: "Bob",
        defaults: {},
        connections: {
          "convex-cloud": {
            self: {
              id: "self", uid: "uid-self", label: "Self-hosted", provider: "convex-cloud", source: "direct",
              authMethod: "direct", scope: "account", revision: 1,
              values: { apiUrl: "https://api.internal.example", adminKey: ADMIN_KEY },
              createdAt: 12, updatedAt: 22,
            },
          },
        },
      },
    },
    bindings: [{ path: "/srv/project", user: "alice", connections: { "convex-cloud": "prod" } }],
  }, null, 2);
  await fs.writeFile(file, original, { mode: 0o600 });
});

afterEach(async () => {
  delete process.env.OS_INFRA_STORE;
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});

async function migrate() {
  return import("./convex-migrate");
}

describe("convex forward migration", () => {
  it("moves every legacy row into the one convex provider and keeps the secret usable", async () => {
    const { migrateConvexConnections } = await migrate();
    const plan = await migrateConvexConnections();
    expect(plan.changed).toBe(true);
    expect(plan.conflicts).toEqual([]);

    const { readIntegrationState } = await import("./connection-storage");
    const state = await readIntegrationState();
    const alice = state.users.alice.connections.convex;
    expect(Object.keys(alice).sort()).toEqual(["admin", "prod"]);
    // The secret VALUE survives, byte for byte, and is never re-entered.
    expect(alice.admin.values.personalToken).toBe(PAT);
    expect(alice.prod.values.deployKey).toBe(DEPLOY_KEY);
    expect(alice.prod.values.deploymentName).toBe("happy-otter-123");
    // Identity and history are preserved, not reset.
    expect(alice.admin).toMatchObject({ id: "admin", uid: "uid-admin", label: "Admin", provider: "convex", revision: 3, createdAt: 10, updatedAt: 20, verifiedAt: 30 });
    expect(alice.prod.lastCheck).toEqual({ revision: 1, checkedAt: 40, result: "verified" });
    // The self-hosted row keeps its own shape and is marked as such.
    expect(state.users.bob.connections.convex.self.values).toEqual({ apiUrl: "https://api.internal.example", adminKey: ADMIN_KEY, deploymentKind: "self-hosted" });
    expect(alice.admin.values.deploymentKind).toBe("cloud");
    expect(alice.prod.authMethod).toBe("deployment");
    expect(state.users.bob.connections.convex.self.authMethod).toBe("admin");
  });

  it("carries defaults and folder bindings to the canonical provider", async () => {
    const { migrateConvexConnections } = await migrate();
    await migrateConvexConnections();
    const { readIntegrationState } = await import("./connection-storage");
    const state = await readIntegrationState();
    expect(state.users.alice.defaults.convex).toBe("admin");
    expect(state.users.alice.defaults["convex-cloud"]).toBeUndefined();
    expect(state.bindings[0].connections).toEqual({ convex: "prod" });
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { migrateConvexConnections } = await migrate();
    await migrateConvexConnections();
    const first = await fs.readFile(file, "utf8");
    const second = await migrateConvexConnections();
    expect(second.changed).toBe(false);
    expect(second.entries).toEqual([]);
    expect(await fs.readFile(file, "utf8")).toBe(first);
  });

  it("dry run reports the plan and writes absolutely nothing", async () => {
    const { dryRunConvexMigration } = await migrate();
    const plan = await dryRunConvexMigration();
    expect(plan.applicable).toBe(true);
    expect(plan.entries.map((entry) => [entry.user, entry.connection, entry.deploymentKind])).toEqual([
      ["alice", "admin", "cloud"],
      ["alice", "prod", "cloud"],
      ["bob", "self", "self-hosted"],
    ]);
    // Secret KEY NAMES only — the credential itself never enters the report.
    expect(plan.entries[0].secretKeys).toEqual(["personalToken"]);
    expect(JSON.stringify(plan)).not.toContain(PAT);
    expect(JSON.stringify(plan)).not.toContain(DEPLOY_KEY);
    expect(JSON.stringify(plan)).not.toContain(ADMIN_KEY);
    // The stored bytes did not move.
    expect(await fs.readFile(file, "utf8")).toBe(original);
  });

  it("reports a conflict instead of overwriting either row", async () => {
    const { mutateIntegrationState } = await import("./connection-storage");
    await mutateIntegrationState((state) => {
      state.users.alice.connections.convex = {
        prod: {
          id: "prod", uid: "uid-existing", label: "Existing", provider: "convex", source: "direct",
          authMethod: "deployment", scope: "deployment", revision: 1,
          values: { deployKey: "synthetic_existing_key_1234567890", deploymentName: "other-deployment" },
          createdAt: 5, updatedAt: 6,
        },
      };
    });
    const { dryRunConvexMigration, migrateConvexConnections } = await migrate();
    const plan = await dryRunConvexMigration();
    expect(plan.applicable).toBe(false);
    expect(plan.conflicts.map((row) => [row.user, row.connection])).toEqual([["alice", "prod"]]);

    await expect(migrateConvexConnections()).rejects.toMatchObject({ code: "convex_migration_conflict" });

    // Neither side was touched: the existing `convex` row is intact and the
    // legacy row is still where the operator left it.
    const { readIntegrationState } = await import("./connection-storage");
    const state = await readIntegrationState();
    expect(state.users.alice.connections.convex.prod.values.deploymentName).toBe("other-deployment");
    expect(state.users.alice.connections["convex-cloud"].prod.values.deploymentName).toBe("happy-otter-123");
  });

  it("never runs implicitly at import time and never reaches the network", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // Importing the module alone must not read or write the store.
    await migrate();
    expect(await fs.readFile(file, "utf8")).toBe(original);
    expect(fetchMock).not.toHaveBeenCalled();
    const { migrateConvexConnections } = await migrate();
    await migrateConvexConnections();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never writes a credential into the non-secret deploymentKind field", async () => {
    const { migrateConvexConnections } = await migrate();
    await migrateConvexConnections();
    const { readIntegrationState } = await import("./connection-storage");
    const state = await readIntegrationState();
    for (const profile of Object.values(state.users)) {
      for (const row of Object.values(profile.connections.convex ?? {})) {
        expect(["cloud", "self-hosted"]).toContain(row.values.deploymentKind);
      }
    }
  });
});

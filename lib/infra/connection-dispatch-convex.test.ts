import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

/**
 * Issue #152, acceptance criterion 5: on the self-hosted kind NO operation may
 * silently 404. Every Convex operation must either run or be refused by NAME with
 * a machine-readable reason the UI can grey out.
 */

let root = "";
let execute: typeof import("./connection-dispatch").executeIntegrationAction;

const CLOUD_PAT = "pat_synthetic_cloud_dispatch_1234567";
const ADMIN_KEY = "synthetic_self_hosted_admin_dispatch_1234";
const operations = ["convex.customDomains.list", "convex.customDomain.ensure", "convex.canonical.get", "convex.canonical.set", "convex.env.presence", "convex.project.deploy", "convex.snapshot.import"];

async function seed(user: string, connection: string, method: string, values: Record<string, string>) {
  const { integrationManage } = await import("./connection-manage");
  const service = await import("./connection-service");
  const { readIntegrationState } = await import("./connection-storage");
  if (!(await readIntegrationState()).users[user])
    await integrationManage({ action: "user.create", confirm: true, user });
  await integrationManage({ action: "connection.create", confirm: true, user, provider: "convex", connection, authMethod: method, source: "direct" });
  const snapshot = await service.credentialSnapshot("convex", { user, connection });
  await service.saveConnectionValues("convex", { user, connection }, values, snapshot.connection, true);
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-dispatch-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  // Kind is INFERRED from shape: apiUrl ⇒ self-hosted, otherwise cloud. That is
  // the same rule a pre-collapse row relies on.
  await seed("cloud", "admin", "personal", { personalToken: CLOUD_PAT });
  await seed("cloud", "prod", "deployment", { deployKey: "prod:happy-otter-123|synthetic_cloud_dispatch_key_123", deploymentName: "happy-otter-123" });
  await seed("self", "self", "admin", { apiUrl: "https://api.internal.example", adminKey: ADMIN_KEY });
  execute = (await import("./connection-dispatch")).executeIntegrationAction;
});

afterAll(async () => {
  delete process.env.OS_INFRA_STORE;
  await fs.rm(root, { recursive: true, force: true });
});

const args: Record<string, Record<string, unknown>> = {
  "convex.customDomains.list": { deploymentName: "happy-otter-123" },
  "convex.customDomain.ensure": { deploymentName: "happy-otter-123", domain: "api.example.test", requestDestination: "convexCloud" },
  "convex.canonical.get": { deploymentName: "happy-otter-123" },
  "convex.canonical.set": { deploymentName: "happy-otter-123", requestDestination: "convexCloud", url: null },
  "convex.env.presence": { deploymentName: "happy-otter-123", names: ["AUTH_SECRET"] },
  "convex.project.deploy": { deploymentName: "happy-otter-123", projectPath: "/srv/project" },
  "convex.snapshot.import": { deploymentName: "happy-otter-123", projectPath: "/srv/project", snapshotPath: "/tmp/s.zip", mode: "append" },
};

async function attempt(user: string, connection: string, operation: string) {
  try {
    await execute({ user, provider: "convex", connection, operation, confirm: true, arguments: args[operation] });
    return { ran: true as const };
  } catch (error) {
    const value = error as Error & { code?: string; operation?: string; deploymentKind?: string; reason?: string | null; status?: number };
    return { ran: false as const, code: value.code, message: value.message, operation: value.operation, deploymentKind: value.deploymentKind, reason: value.reason, status: value.status };
  }
}

describe("self-hosted Convex operations never silently 404", () => {
  it.each(operations)("classifies %s for the self-hosted kind", async (operation) => {
    const outcome = await attempt("self", "self", operation);
    // Either it genuinely ran, or it is refused EXPLICITLY for this kind.
    if (!outcome.ran) {
      expect(outcome.code).toBe("convex_operation_unsupported_for_kind");
      expect(outcome.status).toBe(409);
      expect(outcome.operation).toBe(operation);
      expect(outcome.deploymentKind).toBe("self-hosted");
      expect(outcome.reason?.length).toBeGreaterThan(0);
      // Never the old silent failure mode.
      expect(outcome.code).not.toBe("provider_operation_mismatch");
      expect(outcome.message).not.toMatch(/404|not_found/);
    }
  });

  it("does not refuse the same operations for the cloud kind by kind-gating", async () => {
    // Cloud is expected to reach the real runner (which fails on the fake
    // deployment), never the kind gate.
    for (const operation of operations) {
      const outcome = await attempt("cloud", "admin", operation);
      expect(outcome.ran || outcome.code !== "convex_operation_unsupported_for_kind").toBe(true);
    }
  });

  it("keeps the alias id working for dispatch", async () => {
    const outcome = await attempt("cloud", "admin", "convex.customDomains.list");
    // The only thing that matters here: the retired provider id is not rejected
    // as an unknown/mismatched provider.
    expect(outcome.ran || (outcome.code !== "provider_operation_mismatch")).toBe(true);
  });
});

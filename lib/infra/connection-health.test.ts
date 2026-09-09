import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyIntegrationState } from "./identity";
import { createConnectionIn, saveConnectionValues } from "./connection-service";
import { connectionSummary } from "./connection-registry";
import { recordConnectionCheck } from "./connection-health";

const fixture = vi.hoisted(() => ({ state: null as any }));
vi.mock("./connection-storage", () => ({
  mutateIntegrationState: async (fn: (s: any) => unknown) => fn(fixture.state),
  readIntegrationState: async () => fixture.state,
}));
beforeEach(() => {
  fixture.state = emptyIntegrationState();
  fixture.state.users.owner = { id: "owner", uid: "owner", label: "Owner", connections: {}, defaults: {} };
  const c = createConnectionIn(fixture.state, { user: "owner", provider: "github", connection: "test" });
  c.values = { apiKey: "synthetic-test-key" };
  c.verifiedAt = 10;
});
const current = () => fixture.state.users.owner.connections.github.test;
const snapshot = () => ({ user: "owner", connection: structuredClone(current()) });
describe("revision-bound connection health", () => {
  it("replaces historical verified state after invalid access, then recovers", async () => {
    await recordConnectionCheck("github", snapshot(), { id: "github", ok: false, detail: "GitHub HTTP 401" }, 20);
    expect(connectionSummary("owner", current()).state).toBe("invalid");
    expect(current().verifiedAt).toBe(10);
    await recordConnectionCheck("github", snapshot(), { id: "github", ok: true, detail: "ok" }, 30);
    expect(connectionSummary("owner", current()).state).toBe("verified");
    expect(current().verifiedAt).toBe(30);
  });
  it("distinguishes unavailable providers and stores no raw response", async () => {
    await recordConnectionCheck("github", snapshot(), { id: "github", ok: false, detail: "HTTP 503 secret-response" }, 20);
    expect(connectionSummary("owner", current()).state).toBe("unavailable");
    expect(JSON.stringify(current().lastCheck)).not.toContain("secret-response");
  });
  it("rejects stale results after credential rotation or connection recreation", async () => {
    const old = snapshot();
    current().revision++;
    expect(await recordConnectionCheck("github", old, { id: "github", ok: true, detail: "ok" }, 20)).toBe(false);
    current().revision = old.connection.revision;
    current().uid = "replacement";
    expect(await recordConnectionCheck("github", old, { id: "github", ok: true, detail: "ok" }, 20)).toBe(false);
  });
  it("does not let a slower older request overwrite a later check", async () => {
    const old = snapshot();
    await recordConnectionCheck("github", old, { id: "github", ok: false, detail: "HTTP 401" }, 30);
    expect(await recordConnectionCheck("github", old, { id: "github", ok: true, detail: "ok" }, 20)).toBe(false);
    expect(connectionSummary("owner", current()).state).toBe("invalid");
  });
  it("clears the previous check when saving a new credential revision", async () => {
    await recordConnectionCheck("github", snapshot(), { id: "github", ok: false, detail: "HTTP 401" }, 20);
    await saveConnectionValues("github", { user: "owner", connection: "test" }, { apiKey: "rotated-fixture" }, current());
    expect(current().lastCheck).toBeUndefined();
    expect(connectionSummary("owner", current()).state).toBe("verified");
  });
});

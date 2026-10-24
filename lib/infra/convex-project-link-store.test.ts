// Store-backed half: project associations and the per-project query surface.
// Split from convex-project-link.test.ts to keep both files under the physical-line ratchet.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const root = await mkdtemp(path.join(os.tmpdir(), "mso-convex-link-store-"));
const store = path.join(root, "infra-providers.json");
const SECRET = "synthetic_deploy_key_must_never_leak";
vi.stubEnv("OS_FS_READ_ROOTS", root);
vi.stubEnv("OS_INFRA_STORE", store);

type Row = { projects?: string[]; lastCheck?: unknown };
type State = {
  users: { owner: { connections: Record<string, Record<string, Row>> } };
};
const BASE_STATE = {
  version: 2,
  instanceId: "3f1c0f9e-0000-4000-8000-000000000000",
  defaultUser: "owner",
  users: {
    owner: {
      id: "owner", uid: "owner-uid", label: "Owner",
      defaults: { "convex-cloud": "baton" },
      connections: {
        "convex-cloud": {
          baton: {
            id: "baton", uid: "uid-baton", label: "Baton production", provider: "convex-cloud",
            source: "direct", authMethod: "deployment", scope: "deployment",
            revision: 1, values: { deployKey: SECRET, deploymentName: "veracious-rooster-179" },
            createdAt: 1, updatedAt: 1, verifiedAt: 2,
            lastCheck: { revision: 1, checkedAt: 2, result: "verified" },
          },
        },
        convex: {
          zianinn: {
            id: "zianinn", uid: "uid-zianinn", label: "Zianinn self-hosted", provider: "convex",
            source: "direct", authMethod: "direct", scope: "server",
            revision: 1, values: { apiUrl: "https://api-zianinn.rahmanef.com", adminKey: SECRET },
            createdAt: 1, updatedAt: 1,
            lastCheck: { revision: 1, checkedAt: 2, result: "unavailable" },
          },
        },
      },
    },
  },
  bindings: [],
};

function state(projects: boolean): State {
  const next = structuredClone(BASE_STATE) as unknown as State;
  const rows = next.users.owner.connections;
  if (projects) {
    rows["convex-cloud"].baton.projects = ["containerabc/baton", "containerabc/mimin"];
    rows.convex.zianinn.projects = ["containerabc/baton"];
  }
  return next;
}
const writeState = async (projects: boolean) => writeFile(store, JSON.stringify(state(projects), null, 2), { mode: 0o600 });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeAll(() => { fetchSpy = vi.fn(() => Promise.reject(new Error("network is forbidden"))); globalThis.fetch = fetchSpy as unknown as typeof fetch; });
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("per-project query surface", () => {
  it("parses an old state file with no project field and still behaves", async () => {
    await writeState(false);
    const { projectProviderQuery } = await import("./connection-service");
    const view = await projectProviderQuery();
    expect(view.providers).toHaveLength(2);
    expect(view.providers.every((row) => row.projects.length === 0 && row.projectCount === 0)).toBe(true);
    expect((await projectProviderQuery({ project: "containerabc/baton" })).providers).toEqual([]);
  });

  it("lists two projects on one deployment without duplicating the connection", async () => {
    await writeState(true);
    const { projectProviderQuery } = await import("./connection-service");
    const shared = await projectProviderQuery({ project: "containerabc/mimin" });
    expect(shared.providers.map((row) => row.connection)).toEqual(["baton"]);
    expect(shared.providers[0]).toMatchObject({ projectCount: 2, projects: ["containerabc/baton", "containerabc/mimin"] });
    const baton = await projectProviderQuery({ project: "containerabc/baton" });
    expect(baton.providers.map((row) => row.connection)).toEqual(["zianinn", "baton"]);
    expect(baton.providers.filter((row) => row.connection === "baton")).toHaveLength(1);
    // Cloud and self-hosted rows arrive together: no kind filter.
    expect(baton.providers.map((row) => row.kind).sort()).toEqual(["cloud", "self-hosted"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps deployment-down apart from credential-rejected in the data shape", async () => {
    await writeState(true);
    const { projectProviderQuery } = await import("./connection-service");
    const rows = (await projectProviderQuery({ project: "containerabc/baton" })).providers;
    expect(rows.find((row) => row.connection === "baton")?.state).toBe("linked-healthy");
    expect(rows.find((row) => row.connection === "zianinn")?.state).toBe("deployment-unreachable");
    const rejected: State = state(true);
    rejected.users.owner.connections.convex.zianinn.lastCheck = { revision: 1, checkedAt: 2, result: "invalid" };
    await writeFile(store, JSON.stringify(rejected), { mode: 0o600 });
    const after = (await projectProviderQuery({ project: "containerabc/baton" })).providers;
    expect(after.find((row) => row.connection === "zianinn")?.state).toBe("credential-rejected");
    expect(after.find((row) => row.connection === "baton")?.state).toBe("linked-healthy");
  });

  it("associates one deployment with several projects idempotently and never returns the credential", async () => {
    await writeState(false);
    const { projectProviderQuery, setConnectionProjects } = await import("./connection-service");
    await setConnectionProjects("owner", "convex-cloud", "baton", ["containerabc/baton", "containerabc/mimin", "containerabc/baton"]);
    const again = await setConnectionProjects("owner", "convex-cloud", "baton", ["containerabc/mimin", "containerabc/baton"]);
    expect(again).toMatchObject({ projects: ["containerabc/baton", "containerabc/mimin"], changed: false });
    const view = await projectProviderQuery({ project: "containerabc/baton" });
    expect(view.providers).toHaveLength(1);
    expect(view.providers[0].projectCount).toBe(2);
    for (const result of [view, await projectProviderQuery()]) {
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain("deployKey");
      expect(JSON.stringify(result)).not.toContain("adminKey");
    }
  });

  it("rejects an association that is not a project id", async () => {
    await writeState(false);
    const { setConnectionProjects } = await import("./connection-service");
    await expect(setConnectionProjects("owner", "convex-cloud", "baton", ["../../etc/passwd"])).rejects.toMatchObject({ code: "invalid_project_id" });
    await expect(setConnectionProjects("owner", "convex-cloud", "baton", ["no-container"])).rejects.toMatchObject({ code: "invalid_project_id" });
  });

  it("drops a malformed stored association instead of echoing it back", async () => {
    const dirty: State = state(false);
    dirty.users.owner.connections["convex-cloud"].baton.projects = ["containerabc/baton", "../../etc/passwd"];
    await writeFile(store, JSON.stringify(dirty), { mode: 0o600 });
    const { projectProviderQuery } = await import("./connection-service");
    const view = await projectProviderQuery();
    expect(view.providers.find((row) => row.connection === "baton")?.projects).toEqual(["containerabc/baton"]);
    expect(JSON.stringify(view)).not.toContain("passwd");
  });

  it("links a real folder against the store with no fetch and no secret in the result", async () => {
    await writeState(true);
    const { projectProviderQuery } = await import("./connection-service");
    const { readProjectConvexUsage, linkConvexProject } = await import("./convex-project-link");
    const dir = path.join(root, "store-linked");
    await mkdir(path.join(dir, "convex"), { recursive: true });
    await writeFile(path.join(dir, ".env.local"), `CONVEX_DEPLOYMENT=prod:veracious-rooster-179\nCONVEX_DEPLOY_KEY=${SECRET}\n`);
    const rows = (await projectProviderQuery()).providers;
    const result = linkConvexProject(await readProjectConvexUsage(dir), rows.map((row) => ({
      user: row.user, provider: row.provider, connection: row.connection,
      deploymentName: row.connection === "baton" ? "veracious-rooster-179" : null,
      origin: row.connection === "zianinn" ? "https://api-zianinn.rahmanef.com" : null,
    })));
    expect(result.outcome).toBe("linked");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

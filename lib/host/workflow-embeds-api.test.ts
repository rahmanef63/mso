import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredSurfaceApps } from "@/lib/surfaces/config";
import { listWorkflowEmbeds, workflowEmbeds } from "./workflow-embeds-api";
const app = { id: "automation", title: "Automation", description: "Owner workspace", origin: "https://automation.example.test", startPath: "/home/workflows", renderer: "iframe" as const, presentation: "inline" as const, environment: "production" as const };
afterEach(() => vi.unstubAllEnvs());
describe("reviewed Workflows embed registry", () => {
  it("is disabled by default and requires explicit placement", () => {
    expect(workflowEmbeds([app], [])).toEqual([]);
    expect(workflowEmbeds([{ ...app, placements: ["workflows"] }], [])).toHaveLength(1);
    expect(workflowEmbeds([{ ...app, id: "n8n", title: "n8n", placements: ["n8n"] }], [])).toHaveLength(1);
  });
  it("shares the Page registry and only returns approved non-secret presentation metadata", async () => {
    vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ ...app, placements: ["workflows"], externalAuthPath: "/signin", accessToken: "must-not-leak" }]));
    const result = await listWorkflowEmbeds("https://cockpit.example.test");
    expect(result[0]).toMatchObject({ id: "automation", url: "https://automation.example.test/home/workflows", loginUrl: "https://automation.example.test/signin", renderer: "iframe" });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });
  it("never frames the cockpit or explicitly configured widget origin", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", app.origin);
    vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ ...app, placements: ["workflows"] }]));
    expect((await listWorkflowEmbeds("http://localhost:4005"))[0].renderer).toBe("remote");
    expect(workflowEmbeds([{ ...app, placements: ["workflows"] }], [app.origin])[0].renderer).toBe("remote");
  });
  it("honors a remote-only provider rather than bypassing its frame policy", () => {
    expect(workflowEmbeds([{ ...app, placements: ["workflows"], renderer: "remote" }], [])[0].renderer).toBe("remote");
  });
  it.each(["workflows", ["settings"], [1], null])("rejects invalid placement metadata %j", async (placements) => {
    expect(await configuredSurfaceApps(JSON.stringify([{ ...app, placements }]))).toEqual([]);
  });
  it.each([{ origin: "http://automation.example.test" }, { startPath: "//evil.example.test" }, { sandbox: "allow-top-navigation" }])("rejects unsafe destination or frame permission %j", async (change) => {
    expect(await configuredSurfaceApps(JSON.stringify([{ ...app, placements: ["workflows"], ...change }]))).toEqual([]);
  });
  it("preserves an explicitly empty iframe sandbox as the strictest reviewed policy", async () => {
    const apps = await configuredSurfaceApps(JSON.stringify([{ ...app, placements: ["workflows"], sandbox: "" }]));
    expect(apps[0]).toHaveProperty("sandbox", "");
    expect(workflowEmbeds(apps, [])[0].sandbox).toBe("");
  });
  it("keeps non-workflow apps and approved sandbox permissions unchanged", async () => {
    const apps = await configuredSurfaceApps(JSON.stringify([app, { ...app, id: "reviewed", placements: ["workflows", "workflows"], sandbox: "allow-scripts allow-forms" }]));
    expect(apps[0]).toEqual(app);
    expect(apps[1].placements).toEqual(["workflows"]);
    expect(workflowEmbeds(apps, [])[0].sandbox).toBe("allow-scripts allow-forms");
  });
});

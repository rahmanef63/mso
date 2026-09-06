import { expect, it, vi } from "vitest";
vi.mock("./clients", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clients")>();
  return { ...actual, upsertDokployPublicBuildEnv: vi.fn(async (args) => ({ ...args, changed: true, redeployQueued: true })) };
});
vi.mock("./connection-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./connection-service")>();
  return {
    ...actual,
    resolveIntegration: vi.fn(async () => ({ user:"alice",id:"default",source:"direct",authMethod:"direct",provider:"dokploy" })),
    withIntegrationSelection: vi.fn(async (_selector, fn) => fn()),
  };
});
const { executeIntegrationAction } = await import("./connection-dispatch");
it("allows only the bounded public-env value seam", async () => {
  await expect(executeIntegrationAction({user:"alice",provider:"dokploy",connection:"default",operation:"dokploy.application.publicEnv.upsert",confirm:true,arguments:{applicationId:"ABCDEFGH1234",key:"NEXT_PUBLIC_CONVEX_URL",value:"https://api.example.com"}})).resolves.toMatchObject({result:{changed:true}});
  await expect(executeIntegrationAction({user:"alice",provider:"dokploy",connection:"default",operation:"dokploy.application.publicEnv.upsert",confirm:true,arguments:{applicationId:"ABCDEFGH1234",key:"NEXT_PUBLIC_X",value:"x",token:"secret"}})).rejects.toMatchObject({code:"invalid_tool_arguments"});
});
it("keeps secret-shaped value fields rejected for every other operation", async () => {
  await expect(executeIntegrationAction({user:"alice",provider:"dokploy",connection:"default",operation:"dokploy.projects.list",confirm:true,arguments:{value:"x"}})).rejects.toMatchObject({code:"secret_input_forbidden"});
});

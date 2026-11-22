import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEPLOYMENT_ENV_KEYS,
  deploymentIdentifiers,
  linkConvexProject,
  readProjectConvexUsage,
  type LinkableConnection,
} from "./convex-project-link";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-convex-link-"));
vi.stubEnv("OS_FS_READ_ROOTS", root);

const CLOUD: LinkableConnection = { user: "owner", provider: "convex", connection: "baton", deploymentName: "veracious-rooster-179" };
const SELF: LinkableConnection = { user: "owner", provider: "convex", connection: "zianinn", origin: "https://api-zianinn.rahmanef.com" };
const OTHER: LinkableConnection = { user: "owner", provider: "convex", connection: "other", deploymentName: "another-deployment" };

async function project(name: string, env?: string, options: { convex?: boolean } = {}): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  if (options.convex !== false) await mkdir(path.join(dir, "convex"), { recursive: true });
  if (env) await writeFile(path.join(dir, ".env.local"), env);
  return dir;
}

beforeAll(() => { globalThis.fetch = vi.fn(() => Promise.reject(new Error("network is forbidden in the linker"))); });
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("deterministic Convex project linker", () => {
  it("links a cloud deployment name with no fetch and no secret retained", async () => {
    const dir = await project("cloud", "CONVEX_DEPLOYMENT=prod:veracious-rooster-179\nCONVEX_DEPLOY_KEY=prod:veracious-rooster-179|SYNTHETIC_SECRET_VALUE\n");
    const usage = await readProjectConvexUsage(dir);
    const result = linkConvexProject(usage, [CLOUD, SELF, OTHER]);
    expect(result.outcome).toBe("linked");
    expect(result.reason).toBe("single-match");
    expect(result.matched).toEqual([CLOUD]);
    expect(result.identifiers.deploymentNames).toEqual(["veracious-rooster-179"]);
    expect(JSON.stringify([usage, result])).not.toContain("SYNTHETIC_SECRET_VALUE");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("links a self-hosted origin from CONVEX_SELF_HOSTED_URL and from a public URL var", async () => {
    const selfHosted = linkConvexProject(await readProjectConvexUsage(await project("self", "CONVEX_SELF_HOSTED_URL=https://api-zianinn.rahmanef.com\n")), [CLOUD, SELF]);
    expect(selfHosted.outcome).toBe("linked");
    expect(selfHosted.matched).toEqual([SELF]);
    expect(selfHosted.identifiers.origins).toEqual(["https://api-zianinn.rahmanef.com"]);
    const publicUrl = linkConvexProject(await readProjectConvexUsage(await project("public", "NEXT_PUBLIC_CONVEX_URL=https://api-zianinn.rahmanef.com/api\n")), [SELF]);
    expect(publicUrl.outcome).toBe("linked");
    expect(publicUrl.matched).toHaveLength(1);
  });

  it("links a cloud URL-only repo by deployment hostname", async () => {
    const result = linkConvexProject(await readProjectConvexUsage(await project("url", "VITE_CONVEX_URL=https://veracious-rooster-179.convex.cloud\n")), [CLOUD, SELF]);
    expect(result.outcome).toBe("linked");
    expect(result.matched).toEqual([CLOUD]);
  });

  it("reports unmatched when the repo uses Convex but resolves no identifier", async () => {
    const result = linkConvexProject(await readProjectConvexUsage(await project("bare", undefined)), [CLOUD, SELF]);
    expect(result).toMatchObject({ outcome: "unmatched", reason: "no-identifier", matched: [] });
  });

  it("reports unmatched when an identifier resolves but no stored connection matches", async () => {
    const result = linkConvexProject(await readProjectConvexUsage(await project("nomatch", "CONVEX_DEPLOYMENT=dev:unknown-deployment\n")), [CLOUD, SELF]);
    expect(result).toMatchObject({ outcome: "unmatched", reason: "no-match", matched: [] });
  });

  it("keeps \"no Convex usage\" distinct from unmatched", async () => {
    const usage = await readProjectConvexUsage(await project("plain", "CONVEX_DEPLOYMENT=prod:veracious-rooster-179\n", { convex: false }));
    const result = linkConvexProject(usage, [CLOUD]);
    expect(result.outcome).toBe("no-convex-usage");
    expect(result.reason).toBe("not-a-convex-project");
    expect(result.outcome).not.toBe("unmatched");
  });

  it("reports conflict when two stored connections match the same identifier", async () => {
    const twin: LinkableConnection = { user: "other", provider: "convex", connection: "twin", deploymentName: "veracious-rooster-179" };
    const result = linkConvexProject(await readProjectConvexUsage(await project("twin", "CONVEX_DEPLOYMENT=prod:veracious-rooster-179\n")), [CLOUD, twin]);
    expect(result).toMatchObject({ outcome: "conflict", reason: "multiple-matches" });
    expect(result.matched).toHaveLength(2);
  });

  it("reports conflict when a cloud name and a self-hosted URL disagree in one repo", async () => {
    const dir = await project("mixed", "CONVEX_DEPLOYMENT=prod:veracious-rooster-179\nCONVEX_SELF_HOSTED_URL=https://api-zianinn.rahmanef.com\n");
    const result = linkConvexProject(await readProjectConvexUsage(dir), [CLOUD, SELF]);
    expect(result).toMatchObject({ outcome: "conflict", reason: "identifier-disagreement" });
  });

  it("reports conflict when a repo names two different cloud deployments", async () => {
    const dir = await project("two-names", "CONVEX_DEPLOYMENT=prod:veracious-rooster-179\nNEXT_PUBLIC_CONVEX_URL=https://another-deployment.convex.cloud\n");
    expect(linkConvexProject(await readProjectConvexUsage(dir), [CLOUD, OTHER])).toMatchObject({ outcome: "conflict" });
  });

  it("reads only the allowlisted identifier keys from an env file", () => {
    const identifiers = deploymentIdentifiers([
      "CONVEX_DEPLOYMENT=prod:veracious-rooster-179",
      "CONVEX_SELF_HOSTED_URL=https://api-zianinn.rahmanef.com",
      "CONVEX_DEPLOY_KEY=SYNTHETIC_SECRET_VALUE",
      "SOME_PASSWORD=SYNTHETIC_SECRET_VALUE",
    ].join("\n"));
    expect(Object.keys(identifiers).sort()).toEqual(["deploymentNames", "origins"]);
    expect(JSON.stringify(identifiers)).not.toContain("SYNTHETIC_SECRET_VALUE");
    expect(DEPLOYMENT_ENV_KEYS).not.toContain("CONVEX_DEPLOY_KEY");
  });
});


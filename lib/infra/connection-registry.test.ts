import { describe, expect, it, vi } from "vitest";
import { connectionCatalog, connectionMethods, connectionSources } from "./connection-registry";
import { canonicalProviderId, convexDeploymentKind, normalizeInfraValues, resolveProviderId } from "./catalog";
import { INFRA_PROVIDER_IDS, CONVEX_OPERATION_SUPPORT } from "./types";

describe("integration connection registry", () => {
  it("presents GitHub OAuth routes before the explicit manual token fallback", () => {
    expect(connectionSources("github")).toEqual(["composio", "native-mcp", "direct"]);
    const github = connectionCatalog().find((row) => row.id === "github");
    expect(github?.sources.map((row) => [row.id, row.label])).toEqual([
      ["composio", "Hosted OAuth (Composio)"],
      ["native-mcp", "Provider OAuth / MCP"],
      ["direct", "Manual token fallback"],
    ]);
    expect(connectionMethods("github", "direct")[0]?.label).toBe("Personal access token fallback");
  });

  it("does not reorder unrelated providers", () => {
    expect(connectionSources("vercel")).toEqual(["direct", "composio", "native-mcp"]);
  });

  it("collapses Convex to ONE provider id, keeping every pre-collapse method", () => {
    const ids = [...INFRA_PROVIDER_IDS];
    expect(ids.filter((id) => id === "convex")).toHaveLength(1);
    expect(ids).not.toContain("convex-cloud");
    // One catalog entry, and its methods still declare HOW it authenticates.
    const rows = connectionCatalog().filter((row) => row.id === "convex");
    expect(rows).toHaveLength(1);
    expect(rows[0].sources.find((s) => s.id === "direct")!.methods.map((m) => m.id)).toEqual(["personal", "deployment", "admin"]);
  });

  it("resolves the convex-cloud alias to convex in exactly one place", () => {
    expect(canonicalProviderId("convex-cloud")).toBe("convex");
    expect(canonicalProviderId("convex")).toBe("convex");
    expect(canonicalProviderId("dokploy")).toBe("dokploy");
    expect(resolveProviderId("convex-cloud")).toBe("convex");
    expect(resolveProviderId("not-a-provider")).toBeNull();
    // The alias is readable but is NOT advertised as a provider id.
    expect(INFRA_PROVIDER_IDS).not.toContain("convex-cloud");
  });

  it("validates deploymentKind as a closed enum and rejects a third value", () => {
    expect(normalizeInfraValues("convex", { deploymentKind: "cloud", personalToken: "pat_synthetic_1234567890" }).deploymentKind).toBe("cloud");
    expect(normalizeInfraValues("convex", { deploymentKind: "self-hosted", apiUrl: "https://api.example.test", adminKey: "synthetic_admin_key_123456" }).deploymentKind).toBe("self-hosted");
    expect(() => normalizeInfraValues("convex", { deploymentKind: "cloudy" })).toThrow(/deploymentKind/);
    expect(() => normalizeInfraValues("convex", { deploymentKind: "" })).not.toThrow();
  });

  it("infers the kind from apiUrl when deploymentKind is absent", () => {
    // Legacy rows predate the field entirely.
    expect(convexDeploymentKind({ apiUrl: "https://api.example.test", adminKey: "k" })).toBe("self-hosted");
    expect(convexDeploymentKind({ personalToken: "pat" })).toBe("cloud");
    expect(convexDeploymentKind({ deployKey: "key", deploymentName: "happy-otter-123" })).toBe("cloud");
    // An explicit value wins over the inference, and no third kind is invented.
    expect(convexDeploymentKind({ deploymentKind: "cloud", apiUrl: "https://api.example.test" })).toBe("cloud");
    expect(convexDeploymentKind({ deploymentKind: "bogus" })).toBe("cloud");
  });

  it("persists the non-secret kind on write and keeps the credential secret", async () => {
    const { promises: fs } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-kind-"));
    const previous = process.env.OS_INFRA_STORE;
    process.env.OS_INFRA_STORE = path.join(root, "infra.json");
    vi.resetModules();
    try {
      const { setInfraProvider, readInfraProvider } = await import("./store");
      const ADMIN = "synthetic_self_hosted_admin_key_123456";
      await setInfraProvider("convex", { apiUrl: "https://api.example.test", adminKey: ADMIN });
      expect(await readInfraProvider("convex")).toMatchObject({ deploymentKind: "self-hosted", adminKey: ADMIN });
      // The derived kind is non-secret; the admin key is still stored as a secret
      // field and never surfaces through the summary.
      const { summarizeInfraProvider } = await import("./store");
      const summary = summarizeInfraProvider("convex", await readInfraProvider("convex"));
      expect(summary.values.apiUrl).toBe("https://api.example.test");
      expect(JSON.stringify(summary)).not.toContain(ADMIN);
    } finally {
      if (previous === undefined) delete process.env.OS_INFRA_STORE; else process.env.OS_INFRA_STORE = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("classifies every Convex operation for BOTH deployment kinds", () => {
    for (const row of CONVEX_OPERATION_SUPPORT) {
      expect(["supported", "unsupported"]).toContain(row.cloud);
      expect(["supported", "unsupported"]).toContain(row.selfHosted);
      // Nothing silently disappears: an unsupported kind always carries a reason.
      if (row.cloud === "unsupported" || row.selfHosted === "unsupported") expect(row.reason?.length).toBeGreaterThan(0);
      // The cloud kind keeps every operation it had before the collapse.
      expect(row.cloud).toBe("supported");
    }
    // Every operation the dispatcher knows is classified; no silent 404 path.
    expect(CONVEX_OPERATION_SUPPORT.map((row) => row.operation).sort()).toEqual([
      "convex.canonical.get",
      "convex.canonical.set",
      "convex.customDomain.ensure",
      "convex.customDomains.list",
      "convex.env.presence",
      "convex.project.deploy",
      "convex.snapshot.import",
    ]);
  });
});

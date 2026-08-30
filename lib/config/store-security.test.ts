import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

async function load() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-config-safe-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  vi.resetModules();
  vi.stubEnv("OS_CONFIG_STORE", path.join(root, "config.json"));
  return import("./store");
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("config record safety", () => {
  it("slugifies without a backtracking regexp and preserves numeric provider names", async () => {
    const { slugifyProvider } = await load();
    expect(slugifyProvider("  My Provider / EU  ")).toBe("my-provider-eu");
    expect(slugifyProvider("123 Gateway")).toBe("123-gateway");
    expect(slugifyProvider("***")).toBe("");
    expect(slugifyProvider("a".repeat(100))).toHaveLength(40);
  });

  it("rejects prototype keys at every credential/custom/OAuth boundary", async () => {
    const {
      hostCredentialStore,
      readOAuthBundle,
      removeCustomProvider,
      removeOAuthBundle,
      upsertCustomProvider,
      writeOAuthBundle,
    } = await load();
    const store = hostCredentialStore();
    for (const bad of ["__proto__", "prototype", "constructor", "../openai", "OpenAI", ""]) {
      await expect(store.setKey(undefined, bad, "secret")).rejects.toThrow("invalid provider id");
      await expect(store.deleteKey(undefined, bad)).rejects.toThrow("invalid provider id");
      await expect(upsertCustomProvider(bad, { baseUrl: "https://example.test/v1" })).rejects.toThrow("invalid provider id");
      await expect(removeCustomProvider(bad)).rejects.toThrow("invalid provider id");
      await expect(readOAuthBundle(bad)).rejects.toThrow("invalid provider id");
      await expect(writeOAuthBundle(bad, { kind: "oauth", access: "x", expires: 1 })).rejects.toThrow("invalid provider id");
      await expect(removeOAuthBundle(bad)).rejects.toThrow("invalid provider id");
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("round-trips ordinary maps without mutating Object.prototype", async () => {
    const {
      hostCredentialStore,
      readConfig,
      readOAuthBundle,
      removeCustomProvider,
      removeOAuthBundle,
      selectedCustomConn,
      upsertCustomProvider,
      writeConfig,
      writeOAuthBundle,
    } = await load();
    const credentials = hostCredentialStore();
    await credentials.setKey(undefined, "custom-one", "key-one");
    await credentials.setKey(undefined, "custom-two", "key-two");
    await credentials.deleteKey(undefined, "custom-one");
    await upsertCustomProvider("custom-two", { baseUrl: "https://example.test/v1", protocol: "openai" });
    await writeOAuthBundle("custom-two", { kind: "oauth", access: "token", expires: 123 });
    await writeConfig({ provider: "custom-two", model: "model-a" });

    expect(await credentials.getKey(undefined, "custom-one")).not.toBe("key-one");
    expect(await credentials.getKey(undefined, "custom-two")).toBe("key-two");
    expect(await selectedCustomConn()).toMatchObject({ baseUrl: "https://example.test/v1" });
    expect(await readOAuthBundle("custom-two")).toMatchObject({ access: "token" });
    expect(await readConfig()).toMatchObject({ provider: "custom-two", model: "model-a" });

    await removeCustomProvider("custom-two");
    await removeOAuthBundle("custom-two");
    expect(await selectedCustomConn()).toBeNull();
    expect(await readOAuthBundle("custom-two")).toBeNull();
    expect(Object.prototype).not.toHaveProperty("custom-two");
  });
});

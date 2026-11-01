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

// The provider half of a `provider/model` ref was validated; the model half was not, so a stored
// config value could carry arbitrary text into an outbound request body. CodeQL flagged that as
// js/file-access-to-http (config -> model id -> request). This pins the validation, and the
// legitimate catalogue shapes it must keep accepting.
describe("model id safety", () => {
  it("accepts the shapes real catalogues use", async () => {
    const { safeModelId } = await load();
    for (const ok of [
      "gpt-6.1-sol",
      "claude-opus-5-5-high",
      "meta-llama/llama-4-405b",       // OpenRouter vendor/model
      "deepseek-v4.1-flash:free",      // OpenRouter :free suffix
      "Qwen2.5_Coder_32B",
      "o4-mini",
    ]) {
      expect(safeModelId(ok), ok).toBe(ok);
    }
  });

  it("rejects anything that would travel into a request", async () => {
    const { safeModelId } = await load();
    for (const bad of [
      "",                                  // empty
      " model",                            // leading space
      "model\ninjected",                   // newline
      "model\r\nX-Injected: 1",            // header-ish injection
      "../../etc/passwd",                  // traversal
      "a/../b",
      "model?x=1",                         // query injection
      "model#frag",
      "__proto__",                         // reserved
      "x".repeat(201),                     // over the length cap
    ]) {
      expect(() => safeModelId(bad), JSON.stringify(bad)).toThrow(/invalid model id/);
    }
  });

  it("rejects a bad stored model before it reaches a request", async () => {
    const { writeConfig, resolveModelRef } = await load();
    await writeConfig({ provider: "custom-one", model: "bad\nmodel" });
    await expect(resolveModelRef()).rejects.toThrow(/invalid model id/);
  });
});

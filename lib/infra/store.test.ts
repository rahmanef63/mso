import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root = "";
let file = "";

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-infra-"));
  file = path.join(root, "private", "infra.json");
  process.env.OS_INFRA_STORE = file;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.OS_INFRA_STORE;
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});

describe("infra provider store", () => {
  it("never reports an empty Composio configuration as ready", async () => {
    const store = await import("./store");
    expect(store.summarizeInfraProvider("composio", {}).configured).toBe(false);
    await expect(store.setInfraProvider("composio", {})).rejects.toThrow("required");
    expect(store.summarizeInfraProvider("composio", { orgApiKey: "synthetic-organization-key" }).configured).toBe(true);
  });

  it("normalizes Dokploy, persists owner-only state, and never returns a raw secret in summaries", async () => {
    const store = await import("./store");
    const values = await store.setInfraProvider("dokploy", {
      apiUrl: "https://panel.example.com/",
      apiKey: "d".repeat(32),
      publicIp: "203.0.113.10",
    });
    expect(values.apiUrl).toBe("https://panel.example.com/api");
    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
    const summary = store.summarizeInfraProvider("dokploy", values);
    expect(summary.configured).toBe(true);
    expect(summary.values.apiKey).not.toBe(values.apiKey);
    expect(summary.values.apiKey).toBe("configured");
  });

  it("merges rotations under the security-store lock instead of erasing unrelated provider fields", async () => {
    const store = await import("./store");
    await store.setInfraProvider("cloudflare", { apiToken: "a".repeat(32), accountId: "account-1234567890" });
    await store.setInfraProvider("cloudflare", { zoneId: "f".repeat(32) });
    const values = await store.readInfraProvider("cloudflare");
    expect(values.apiToken).toBe("a".repeat(32));
    expect(values.accountId).toBe("account-1234567890");
    expect(values.zoneId).toBe("f".repeat(32));
  });

  it("refuses a symlinked provider store instead of following it into another file", async () => {
    const target = path.join(root, "target.json");
    await fs.writeFile(target, JSON.stringify({ providers: {} }), { mode: 0o600 });
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.symlink(target, file);
    const store = await import("./store");
    await expect(store.readInfraProvider("dokploy")).rejects.toThrow();
  });

  it("refuses an insecure remote Dokploy endpoint and malformed IPs before persisting", async () => {
    const store = await import("./store");
    await expect(store.setInfraProvider("dokploy", { apiUrl: "http://panel.example.com", apiKey: "x".repeat(32) })).rejects.toThrow("HTTPS");
    await expect(store.setInfraProvider("dokploy", { apiUrl: "https://panel.example.com", apiKey: "x".repeat(32), publicIp: "999.1.1.1" })).rejects.toThrow("IPv4");
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

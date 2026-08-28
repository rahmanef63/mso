import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

async function load() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-model-catalog-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  const cache = path.join(root, "catalog.json");
  vi.resetModules();
  vi.stubEnv("MODELS_CACHE_FILE", cache);
  return { root, cache, mod: await import("./catalog.js") };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bounded models.dev catalog cache", () => {
  it("fetches only the fixed endpoint and writes a private atomic cache", async () => {
    const body = JSON.stringify({ openai: { models: { "gpt-test": { name: "GPT Test" } } } });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { root, cache, mod } = await load();

    await expect(mod.getCatalog({ force: true })).resolves.toMatchObject({ openai: { models: { "gpt-test": {} } } });
    expect(fetchMock).toHaveBeenCalledWith("https://models.dev/api.json", expect.objectContaining({ redirect: "error" }));
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(cache).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(cache, "utf8")).data.openai.models).toHaveProperty("gpt-test");
    expect(fs.readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects an over-limit response before reading its body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(13 * 1024 * 1024) },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { mod } = await load();
    await expect(mod.getCatalog({ force: true })).rejects.toThrow("exceeds size limit");
  });

  it("uses a validated stale cache when the fixed network endpoint is unavailable", async () => {
    const { cache, mod } = await load();
    fs.writeFileSync(cache, JSON.stringify({
      at: 1,
      data: { local: { models: { fallback: { name: "Fallback" } } } },
    }), { mode: 0o600 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(mod.getCatalog({ force: true })).resolves.toMatchObject({ local: { models: { fallback: {} } } });
  });

  it("never follows a symlinked cache file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-model-catalog-"));
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mso-model-poison-"));
    fs.chmodSync(root, 0o700);
    fs.chmodSync(outsideRoot, 0o700);
    roots.push(root, outsideRoot);
    const outside = path.join(outsideRoot, "outside.json");
    const cache = path.join(root, `catalog-${randomUUID()}.json`);
    fs.writeFileSync(outside, JSON.stringify({ at: 1, data: { poisoned: { models: {} } } }), { mode: 0o600 });
    fs.symlinkSync(outside, cache);
    vi.resetModules();
    vi.stubEnv("MODELS_CACHE_FILE", cache);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const mod = await import("./catalog.js");
    await expect(mod.getCatalog({ force: true })).rejects.toThrow("offline");
  });
});

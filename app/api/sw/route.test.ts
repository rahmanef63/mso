import { existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

const ORIGIN = "https://synthetic.test";
type WorkerEvent = { request: Request; respondWith: (result: Promise<Response>) => void; waitUntil: (result: Promise<unknown>) => void };

async function worker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stored = new Map<string, Response>(), fetched: string[] = [], installed: string[] = [];
  const cache = {
    addAll: async (urls: string[]) => { installed.push(...urls); },
    match: async (request: Request) => stored.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => { stored.set(request.url, response); },
  };
  const context = {
    self: { location: { origin: ORIGIN }, addEventListener: (name: string, listener: (event: WorkerEvent) => void) => listeners.set(name, listener) },
    caches: { open: async () => cache }, URL,
    fetch: async (request: Request) => { fetched.push(request.url); return new Response("synthetic public icon"); },
    assetPaths: [] as string[],
  };
  const response = GET();
  expect(response.headers.get("Service-Worker-Allowed")).toBe("/");
  vm.runInNewContext(await response.text() + "\nglobalThis.assetPaths = ASSETS;", context);
  return {
    fetched, installed, stored, assetPaths: Array.from(context.assetPaths),
    install: async () => {
      let pending: Promise<unknown> | undefined;
      listeners.get("install")!({ request: new Request(ORIGIN), respondWith: () => {}, waitUntil: work => { pending = work; } });
      await pending;
    },
    request: (url: string, method = "GET") => {
      let pending: Promise<Response> | undefined;
      listeners.get("fetch")!({ request: new Request(new URL(url, ORIGIN), { method }), respondWith: result => { pending = result; }, waitUntil: () => {} });
      return pending;
    },
  };
}

describe("public artwork service worker", () => {
  it("installs only three bootstrap files, without warming unused artwork", async () => {
    const sw = await worker(); await sw.install();
    expect(sw.installed).toEqual(["/icon.svg", "/icon-maskable.svg", "/manifest.webmanifest"]);
    expect(sw.fetched).toEqual([]);
  });

  it("allows only existing public icons and the manifest, including every responsive variant", async () => {
    const sw = await worker();
    expect(sw.assetPaths.filter(asset => asset.endsWith(".avif"))).toHaveLength(30);
    expect(sw.assetPaths.filter(asset => asset.endsWith("-128.webp"))).toHaveLength(42);
    for (const asset of sw.assetPaths) {
      if (asset === "/manifest.webmanifest") continue;
      expect(asset).toMatch(/^\/(?:icon(?:-maskable)?\.svg|app-icons\/[a-z0-9/-]+\.(?:webp|avif)|brand\/official\/[a-z]+\.webp)$/);
      expect(existsSync(path.resolve("public", asset.slice(1)))).toBe(true);
    }
  });

  it.each(["/app-icons/launchpad.avif", "/app-icons/mission-control.avif", "/app-icons/macos/files.avif", "/app-icons/macos/files.webp", "/app-icons/macos/files-128.webp"])("caches %s on first use and serves a subsequent hit", async asset => {
    const sw = await worker();
    expect(await (await sw.request(asset))?.text()).toBe("synthetic public icon");
    expect(await (await sw.request(asset))?.text()).toBe("synthetic public icon");
    expect(sw.fetched).toEqual([ORIGIN + asset]);
    expect(sw.stored.size).toBe(1);
  });

  it.each(["/api/v1/agent-vault", "/agent-vault", "/_next/static/chunks/synthetic.js", "https://other.synthetic.test/app-icons/macos/files.avif", "/app-icons/unknown.avif"])("does not intercept or cache %s", async url => {
    const sw = await worker(); expect(sw.request(url)).toBeUndefined();
    expect(sw.fetched).toEqual([]); expect(sw.stored.size).toBe(0);
  });

  it("does not intercept non-GET requests even for an allowed icon", async () => {
    const sw = await worker(); expect(sw.request("/app-icons/macos/files.avif", "POST")).toBeUndefined();
    expect(sw.fetched).toEqual([]); expect(sw.stored.size).toBe(0);
  });
});

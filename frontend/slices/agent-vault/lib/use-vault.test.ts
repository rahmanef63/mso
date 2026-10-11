import { afterEach, describe, expect, it, vi } from "vitest";
import { vaultRequest } from "./use-vault";

const view = { state: { schemaVersion: 1, project: { id: "qa", name: "Synthetic QA", path: "/qa/generated" }, root: "/qa/vault", current: null, snapshots: [], refreshedAt: null } };
afterEach(() => vi.unstubAllGlobals());

describe("Vault request scheduling", () => {
  it.each([undefined, "Snapshots/synthetic/worker.md"])("prioritizes an actual read while preserving no-store and cancellation (%s)", async note => {
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json(view)); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(await vaultRequest(" /qa/generated ", controller.signal, false, note)).toEqual(view);
    const [url, options] = fetch.mock.calls[0]!;
    const query = new URL(url, "https://qa.example.invalid").searchParams;
    expect(query.get("project")).toBe("/qa/generated");
    expect(query.get("note")).toBe(note ?? null);
    expect(options).toEqual({ cache: "no-store", signal: controller.signal, priority: "high" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps refresh as the existing cancellable POST", async () => {
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json(view)); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await vaultRequest("/qa/generated", controller.signal, true);
    expect(fetch).toHaveBeenCalledWith("/api/v1/agent-vault?project=%2Fqa%2Fgenerated", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: "/qa/generated" }), signal: controller.signal });
  });

  it("still surfaces a refused read instead of cached content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Synthetic denied read" }, { status: 403 })));
    await expect(vaultRequest("/qa/generated", new AbortController().signal)).rejects.toThrow("Synthetic denied read");
  });
});

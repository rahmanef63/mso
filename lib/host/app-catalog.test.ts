import { describe, expect, it, vi } from "vitest";
import { APP_CATALOG_URL } from "@/lib/contracts/app-catalog";
import { createAppCatalogLoader } from "./app-catalog";

const valid = JSON.stringify({ schema: "urn:manef:app-catalog:v1", schemaVersion: 1, entries: [{ kind: "managed", id: "hermes" }] });
const response = () => new Response(valid, { headers: { "content-type": "application/json" } });

describe("MANEF catalog delivery", () => {
  it("pins the source, omits credentials, caches success and keeps the last valid data during an outage", async () => {
    let now = 100;
    const fetcher = vi.fn().mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    const load = createAppCatalogLoader(fetcher as typeof fetch, () => now);
    expect((await load()).status).toBe("remote");
    expect(fetcher).toHaveBeenCalledWith(APP_CATALOG_URL, expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
    expect((await load()).status).toBe("remote");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 16 * 60_000;
    expect(await load()).toMatchObject({ status: "stale", entries: [{ kind: "managed", id: "hermes" }] });
    now += 25 * 60 * 60_000;
    expect(await load()).toEqual({ status: "unavailable", entries: [] });
  });
  it("rejects oversized or non-JSON responses without exposing unvalidated entries", async () => {
    const tooLarge = new Response("x".repeat(32_769), { headers: { "content-type": "application/json" } });
    expect(await createAppCatalogLoader(vi.fn().mockResolvedValue(tooLarge) as typeof fetch)()).toEqual({ status: "unavailable", entries: [] });
    expect(await createAppCatalogLoader(vi.fn().mockResolvedValue(new Response(valid, { headers: { "content-type": "text/html" } })) as typeof fetch)()).toEqual({ status: "unavailable", entries: [] });
  });
});

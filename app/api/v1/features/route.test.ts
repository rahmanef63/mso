import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installModularFeaturePackage } from "@/lib/features/registry";

const getSessionContext = vi.fn();
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: () => getSessionContext(),
}));

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  getSessionContext.mockReset();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("/api/v1/features routes", () => {
  it("requires authentication and enforces per-feature role + sandbox headers", async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), "mso-feat-api-"));
    const store = mkdtempSync(path.join(os.tmpdir(), "mso-feat-store-"));
    dirs.push(work, store);
    mkdirSync(path.join(work, "dist"), { recursive: true });
    writeFileSync(path.join(work, "dist", "index.html"), "<p>ok</p>");
    writeFileSync(
      path.join(work, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, id: "ops-board", version: "0.2.0", title: "Ops Board", minRole: "operator", entry: "index.html" }),
    );
    installModularFeaturePackage(work, store);
    vi.stubEnv("MSO_FEATURES_DIR", store);

    const { handleGetModularFeatures, handleGetModularFeatureAsset } = await import("@/lib/features/http-service");

    getSessionContext.mockResolvedValue(null);
    expect((await handleGetModularFeatures()).status).toBe(401);
    expect((await handleGetModularFeatureAsset("ops-board", ["index.html"])).status).toBe(401);

    getSessionContext.mockResolvedValue({ session: { device_id: "dev-1" }, role: "viewer" });
    const viewerList = await handleGetModularFeatures();
    expect(viewerList.status).toBe(200);
    expect((await viewerList.json()).features).toEqual([]);
    expect((await handleGetModularFeatureAsset("ops-board", ["index.html"])).status).toBe(403);

    getSessionContext.mockResolvedValue({ session: { device_id: "dev-2" }, role: "owner" });
    const ownerAsset = await handleGetModularFeatureAsset("ops-board", ["index.html"]);
    expect(ownerAsset.status).toBe(200);
    expect(ownerAsset.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(ownerAsset.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(ownerAsset.headers.get("X-MSO-Feature-Version")).toBe("0.2.0");
    expect(ownerAsset.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(await ownerAsset.text()).toBe("<p>ok</p>");
  });
});

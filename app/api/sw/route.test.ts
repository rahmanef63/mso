import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/sw", () => {
  it("serves service worker as a public asset with 200 OK", async () => {
    const res = GET();
    expect(res.status).toBe(200);
  });

  it("sets required caching and service worker headers", async () => {
    const res = GET();
    expect(res.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/");
  });

  it("contains service worker lifecycle listeners and asset list", async () => {
    const res = GET();
    const text = await res.text();
    expect(text).toContain("self.addEventListener(\"install\"");
    expect(text).toContain("self.addEventListener(\"activate\"");
    expect(text).toContain("self.addEventListener(\"fetch\"");
    expect(text).toContain("/manifest.webmanifest");
    for (const asset of [
      "/brand/official/camoufox.webp",
      "/brand/official/hermes.webp",
      "/brand/official/openclaw.webp",
      "/brand/official/9router.webp",
      "/brand/official/n8n.webp",
      "/brand/official/orca.webp",
      "/brand/official/dokploy.webp",
      "/brand/official/cloudflare.webp",
      "/brand/official/composio.webp",
      "/brand/official/doku.webp",
    ]) {
      expect(text).toContain(asset);
    }
    for (const staleAsset of [
      "/app-icons/camoufox.webp",
      "/app-icons/hermes.webp",
      "/app-icons/openclaw.webp",
      "/app-icons/macos/openclaw.webp",
      "/app-icons/windows/openclaw.webp",
    ]) {
      expect(text).not.toContain(staleAsset);
    }
  });
});

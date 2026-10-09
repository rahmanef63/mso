import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as authorization } from "./oauth-authorization-server/route";
import { GET as resource } from "./oauth-protected-resource/route";
afterEach(() => vi.unstubAllEnvs());

describe("OAuth discovery origin integrity", () => {
  it.each([authorization, resource])("ignores forwarded authority with and without a pinned origin", async (get) => {
    vi.stubEnv("OS_MCP_ENABLED", "1");
    const req = new Request("https://mso.example.test/.well-known/oauth-authorization-server", {headers: {host: "mso.example.test", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http"}});
    for (const pinned of ["", "https://public.example.test"]) {
      vi.stubEnv("OS_PUBLIC_ORIGIN", pinned);
      const response = await get(req);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const json = JSON.stringify(await response.json());
      expect(json).toContain(pinned || "https://mso.example.test");
      expect(json).not.toContain("attacker.example");
      expect(json).not.toContain("http://");
    }
  });
});

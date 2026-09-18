import { afterEach, expect, it, vi } from "vitest";
import { surfaceApps, surfaceAppById, resolveSurfaceRoute } from "./surface-catalog";
afterEach(() => vi.unstubAllEnvs());
it("rejects Page access to an external editor in the cockpit cookie domain", async () => {
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com");
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", ".mso.example.com");
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ id: "external", title: "External editor", origin: "https://editor.mso.example.com", startPath: "/", renderer: "iframe", presentation: "inline", environment: "production", placements: ["mcp-page"] }]));
  expect(await surfaceApps()).toEqual([]);
  expect(await surfaceAppById("external")).toBeUndefined();
  await expect(resolveSurfaceRoute("/apps/external")).rejects.toThrow("unknown MSO Page app");
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "");
  expect((await surfaceApps())[0].id).toBe("external");
});

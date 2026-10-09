import { afterEach, expect, it, vi } from "vitest";
import { surfaceApps, surfaceAppById, resolveSurfaceRoute } from "./surface-catalog";
afterEach(() => vi.unstubAllEnvs());
it("rejects Page access on another cockpit port and allows a separately authenticated sibling", async () => {
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com");
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", ".mso.example.com");
  const app = { id: "external", title: "External editor", origin: "https://mso.example.com:8443", startPath: "/", renderer: "iframe", presentation: "inline", environment: "production", placements: ["mcp-page"] };
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app]));
  expect(await surfaceApps()).toEqual([]);
  expect(await surfaceAppById("external")).toBeUndefined();
  await expect(resolveSurfaceRoute("/apps/external")).rejects.toThrow("unknown MSO Page app");
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "");
  expect(await surfaceApps()).toEqual([]);
  vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([{ ...app, origin: "https://editor.mso.example.com" }]));
  expect((await surfaceApps())[0].id).toBe("external");
});

import { describe, expect, it } from "vitest";
import { cloudflareApp, dokployApp } from "./index";

describe("infrastructure slice descriptors", () => {
  it("exports distinct lazy descriptors for dokploy and cloudflare", () => {
    expect(dokployApp.id).toBe("dokploy");
    expect(dokployApp.title).toBe("Dokploy");
    expect(typeof dokployApp.load).toBe("function");
    expect(cloudflareApp.id).toBe("cloudflare");
    expect(cloudflareApp.title).toBe("Cloudflare");
    expect(typeof cloudflareApp.load).toBe("function");
  });
});

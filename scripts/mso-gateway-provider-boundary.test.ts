import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("gateway provider adapter boundary", () => {
  it("keeps Cloudflare implementation imports out of the generic dispatcher", () => {
    const dispatcher = read("scripts/mso-gateway");
    expect(dispatcher).toContain('scripts/lib/gateway-provider.sh');
    expect(dispatcher).not.toContain('scripts/lib/gateway-tool.sh');
    expect(dispatcher).not.toContain('scripts/lib/gateway-tunnel.sh');
    expect(dispatcher).not.toContain("CLOUDFLARED");
    expect(dispatcher).not.toContain("CF_LOG");
  });

  it("keeps provisional process handling provider-neutral and routes probes through the adapter", () => {
    const pending = read("scripts/lib/gateway-pending.sh");
    const reconcile = read("scripts/lib/gateway-reconcile.sh");
    const provider = read("scripts/lib/gateway-provider.sh");

    expect(pending).not.toContain("trycloudflare");
    expect(pending).not.toContain("cloudflared");
    expect(pending).not.toContain("CF_LOG");
    expect(pending).toContain("PROVIDER_LOG");

    expect(reconcile).toContain('gateway_provider_probe_public "$provider"');
    expect(reconcile).not.toMatch(/\bgateway_probe_public\b/);

    expect(provider).toContain('scripts/lib/gateway-tool.sh');
    expect(provider).toContain('scripts/lib/gateway-tunnel.sh');
    expect(provider).toContain('scripts/lib/gateway-cloudflare-edge.sh');
    expect(provider).toContain("gateway_provider_load_cloudflare_adapter");
  });
});

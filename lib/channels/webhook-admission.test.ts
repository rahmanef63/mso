import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
afterEach(() => vi.unstubAllEnvs());

it("bounds ID/IP churn without evicting the global ingress budget", async () => {
  vi.resetModules();
  vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "1");
  const { admitChannelWebhook } = await import("./webhook-admission");
  const { rateLimitedUntrusted } = await import("@/lib/host/rate-limit");
  for (let n = 0; n < 600; n++) admitChannelWebhook(new Request("https://host.test", { headers: { "x-forwarded-for": `198.51.${Math.floor(n / 250)}.${n % 250}` } }), randomUUID());
  for (let n = 0; n < 5000; n++) rateLimitedUntrusted(`unrelated:${n}`, 1, 60_000);
  expect(() => admitChannelWebhook(new Request("https://host.test"), randomUUID())).toThrow("rate_limited");
  expect(() => admitChannelWebhook(new Request("https://host.test"), "arbitrary-id")).toThrow("channel_not_found");
});
it("rejects rotating forwarding headers as source attribution without explicit proxy trust", async () => {
  vi.resetModules();
  vi.stubEnv("OS_TRUSTED_PROXY_HOPS", "0");
  const { admitChannelWebhook } = await import("./webhook-admission");
  for (let n = 0; n < 60; n++) admitChannelWebhook(new Request("https://host.test", { headers: { "x-forwarded-for": `198.51.100.${n}` } }), randomUUID());
  expect(() => admitChannelWebhook(new Request("https://host.test", { headers: { "x-forwarded-for": "203.0.113.9" } }), randomUUID())).toThrow("rate_limited");
});

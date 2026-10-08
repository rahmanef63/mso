import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

it("bounds ID/IP churn without evicting the global ingress budget", async () => {
  vi.resetModules();
  const { admitChannelWebhook } = await import("./webhook-admission");
  const { rateLimitedUntrusted } = await import("@/lib/host/rate-limit");
  for (let n = 0; n < 600; n++) admitChannelWebhook(new Request("https://host.test", { headers: { "x-forwarded-for": `spoof-${n}` } }), randomUUID());
  for (let n = 0; n < 5000; n++) rateLimitedUntrusted(`unrelated:${n}`, 1, 60_000);
  expect(() => admitChannelWebhook(new Request("https://host.test"), randomUUID())).toThrow("rate_limited");
  expect(() => admitChannelWebhook(new Request("https://host.test"), "arbitrary-id")).toThrow("channel_not_found");
});

import { createHash } from "node:crypto";
import { rateLimitedUntrusted } from "@/lib/host/rate-limit";
import { clientIp } from "@/lib/host/request-ip";
import { ChannelError } from "./errors";

let window = { count: 0, resetAt: 0 };

export function admitChannelWebhook(req: Request, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ChannelError("channel_not_found", 404);
  const source = createHash("sha256").update(clientIp(req).slice(0, 256)).digest("hex");
  if (Date.now() >= window.resetAt) window = { count: 0, resetAt: Date.now() + 60_000 };
  if (++window.count > 600 || rateLimitedUntrusted(`channel-ingress:source:${source}`, 60, 60_000))
    throw new ChannelError("rate_limited", 429);
}

import { isIP } from "node:net";

/** Forwarded attribution requires an explicit proxy count and a firewalled origin. Never authorization. */
export function clientIp(req: Request): string {
  const trusted = Number(process.env.OS_TRUSTED_PROXY_HOPS ?? "0");
  const trail = req.headers.get("x-forwarded-for") ?? "";
  if (!Number.isInteger(trusted) || trusted < 1 || trusted > 16 || trail.length > 4096) return "unknown";
  const hops = trail.split(",").map(value => value.trim());
  const address = hops[hops.length - trusted];
  return hops.length <= 32 && address && isIP(address) ? address : "unknown";
}

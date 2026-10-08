import type { Scope } from "@/lib/capabilities/scope";
import { isA2ALoopbackUrl } from "./network";

export function assertA2ADestinationAuthority(url: string, scope: Scope = "read") {
  if (isA2ALoopbackUrl(url) && scope !== "exec") throw new Error("A2A loopback requires exec authority");
}

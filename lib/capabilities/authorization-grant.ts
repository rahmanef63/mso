import type { SessionPayload } from "@/lib/auth/session";

/** References server-owned authority; never a bearer secret or caller input. */
export type AuthorizationGrant =
  | { kind: "mcp"; id: string; resource: string; fingerprint: string }
  | { kind: "device"; session: SessionPayload };

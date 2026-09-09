import { mutateIntegrationState } from "./connection-storage";
import type { IntegrationConnection } from "./identity";
import type { InfraDoctorResult } from "./types";

// Persist only a bounded category, never provider payloads or credentials.
export function checkCategory(result: InfraDoctorResult) {
  if (result.ok === true) return "verified" as const;
  if (result.ok === null) return "unconfigured" as const;
  // 403 can mean insufficient scope; label invalid access, not necessarily a bad key.
  return /\bHTTP (401|403)\b|invalid.*(?:token|credential)|token.*(?:expired|revoked)/i.test(result.detail)
    ? "invalid" as const : "unavailable" as const;
}

export async function recordConnectionCheck(
  provider: string,
  snapshot: { user: string; connection: IntegrationConnection },
  result: InfraDoctorResult,
  checkedAt: number,
): Promise<boolean> {
  return mutateIntegrationState(state => {
    const previous = snapshot.connection;
    const current = state.users[snapshot.user]?.connections[provider]?.[previous.id];
    if (!current || current.uid !== previous.uid || current.revision !== previous.revision) return false;
    if (current.lastCheck && current.lastCheck.checkedAt > checkedAt) return false;
    const category = checkCategory(result);
    current.lastCheck = { revision: current.revision, checkedAt, result: category };
    if (category === "verified") current.verifiedAt = checkedAt;
    // Preserve the historic last success, but summary state always uses lastCheck.
    return true;
  });
}

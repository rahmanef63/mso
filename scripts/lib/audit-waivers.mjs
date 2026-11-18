// Expiry for the dependency-audit waivers in scripts/audit.mjs.
//
// Split out so the rule is testable without spawning the whole audit: a waiver that
// never expires is a permanent hole, and `accepted` used to be documentation that
// nothing read. Moving that date to 2020 still passed the strict gate.
export const WAIVER_DAYS = 90;

/** The last day a waiver accepted on `accepted` may suppress an advisory. */
export function waiverExpiry(accepted) {
  const at = Date.parse(accepted);
  if (!Number.isFinite(at)) return null;
  return new Date(at + WAIVER_DAYS * 24 * 60 * 60 * 1000);
}

/** One line per waiver that can no longer suppress anything, or is unreadable. */
export function expiredWaivers(waivers, now = Date.now()) {
  const expired = [];
  for (const [id, waiver] of Object.entries(waivers ?? {})) {
    const expiry = waiverExpiry(waiver?.accepted);
    if (!expiry) {
      expired.push(`${id} has an unparseable accepted date ${JSON.stringify(waiver?.accepted)}`);
      continue;
    }
    if (expiry.getTime() <= now) {
      expired.push(`${id} was accepted ${waiver.accepted} and expired ${expiry.toISOString().slice(0, 10)}`);
    }
  }
  return expired;
}

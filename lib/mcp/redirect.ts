import { isAllowedRedirect } from "./pkce";

/**
 * The two URLs the consent page has to build, kept out of the page so they can
 * be tested. Both were previously inline and neither was covered:
 *
 *  - the deny URL was not built at all — Cancel called `history.back()`, so a
 *    refusal never reached the client and the connector dialog hung;
 *  - the "come back here" URL did not exist — an unauthenticated visitor was
 *    sent to `/` and the whole authorization request was discarded.
 */

/** Only the params a re-request needs. Anything else a client sent is dropped. */
const CARRIED = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

/**
 * The same authorization request, addressable again after the visitor unlocks
 * mso in another tab. Nothing is stored: the request lives in this URL.
 *
 * Rebuilt from an allowlist rather than echoed wholesale — the query string is
 * attacker-influenced, and a link this page renders should carry only what the
 * flow actually reads.
 */
export function selfUrl(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const key of CARRIED) {
    const raw = query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    // A repeated parameter takes the first value, matching what the page reads.
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  const qs = params.toString();
  return qs.length > 0 ? `/oauth/authorize?${qs}` : "/oauth/authorize";
}

/**
 * Where Cancel goes: back to the client, saying it was refused.
 *
 * RFC 6749 §4.1.2.1. `state` rides along because a client that cannot match a
 * response to its own request must discard it — omitting it on the denial path
 * breaks well-behaved clients specifically.
 *
 * Returns null when the target is not one we would have redirected to anyway.
 * The caller renders no Cancel link in that case rather than a broken one: a
 * refusal is not a reason to relax the check that guards the success path.
 */
export function denyUrl(redirectUri: string, state: string, issuer?: string): string | null {
  if (!isAllowedRedirect(redirectUri)) return null;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  url.searchParams.set("error", "access_denied");
  if (state) url.searchParams.set("state", state);
  if (issuer) url.searchParams.set("iss", issuer);
  return url.toString();
}

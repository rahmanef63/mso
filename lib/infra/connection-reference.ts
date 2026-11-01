// One addressable reference for an integration connection.
//
// Two forms, derived from the same identity, because they serve different readers:
//
//   mso-integration:<user>/<provider>/<connection>      <- paste this into an agent prompt
//   https://<origin>/integrations?user=…&provider=…&connection=…   <- click this
//
// Why two: the URL is fetchable, so an agent handed only a URL will try to GET it, hit the owner
// gate (403) or a login redirect, and burn a turn learning nothing. The token is deliberately not
// fetchable — it parses as three path segments and nothing else. The URL exists because a human
// still wants to click through to the row that was meant.
//
// Why all three components and not just the connection id: `connection` ids are per-user
// (`dita/dita-convex` vs `cloud/admin` can both be named `convex`), and `user` is part of the
// resolution input. The triple is the smallest thing that resolves unambiguously.
//
// Stability, verified in connection-manage.ts:
//   - `connection` id survives rename (rename only touches `label`) -> safe
//   - `user` id does NOT survive `user.rename` (it deletes the old key) -> a reference dies on
//     rename, and that is correct: a stale reference should fail loudly, never resolve to a
//     different user's connection
//   - `uid` (uuid) is never used here: it is regenerated on duplicate/share/import-export, so it
//     is not portable
import { canonicalProviderId, resolveProviderId } from "./catalog";
import { IntegrationError } from "./identity";

const TOKEN_PREFIX = "mso-integration:";

export type IntegrationRef = { user: string; provider: string; connection: string };

/** The paste-into-a-prompt form. Unfetchable on purpose. */
export function integrationReference(input: IntegrationRef): string {
  return `${TOKEN_PREFIX}${input.user}/${canonicalProviderId(input.provider)}/${input.connection}`;
}

/** The clickable form. Query shape matches what the Google authorization path already emits. */
export function integrationDeepLink(origin: string, input: IntegrationRef): string {
  const base = origin.replace(/\/+$/, "");
  const query = new URLSearchParams({
    user: input.user,
    provider: canonicalProviderId(input.provider),
    connection: input.connection,
  });
  return `${base}/integrations?${query.toString()}`;
}

/**
 * Parse a pasted reference. Accepts the token form, a bare `user/provider/connection` triple, or a
 * URL carrying all three query parameters — because people paste whichever they copied.
 */
export function parseIntegrationReference(value: string): IntegrationRef | null {
  const raw = value.trim();
  if (!raw) return null;

  if (raw.startsWith(TOKEN_PREFIX)) {
    const parts = raw.slice(TOKEN_PREFIX.length).split("/");
    return parts.length === 3 ? triple(parts) : null;
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const params = new URL(raw).searchParams;
      const user = params.get("user"), provider = params.get("provider"), connection = params.get("connection");
      return user && provider && connection ? triple([user, provider, connection]) : null;
    } catch {
      return null;
    }
  }

  // A bare triple only. Anything containing a scheme was handled above; do not let a malformed URL
  // fall through and be read as `provider/model/path`.
  const parts = raw.split("/");
  return parts.length === 3 && !raw.includes("://") ? triple(parts) : null;
}

/** The identity regex forbids `/`, so three segments never need escaping. */
function triple(parts: string[]): IntegrationRef | null {
  const [user, provider, connection] = parts.map((part) => part.trim());
  if (!user || !provider || !connection) return null;
  try {
    // Reject anything the store would refuse anyway, so a malformed paste fails here with a clear
    // answer instead of surfacing as `user_not_found` three calls later.
    // `canonicalProviderId` only folds the legacy alias; `resolveProviderId` is what actually
    // rejects an id the catalog does not know.
    const id = resolveProviderId(provider);
    if (!id) return null;
    return { user, provider: id, connection };
  } catch (error) {
    if (error instanceof IntegrationError) return null;
    throw error;
  }
}

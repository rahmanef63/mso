/**
 * Canonical, copyable address for one named connection.
 *
 * An operator who wants an agent to work on a specific account should not have to
 * describe it in prose ("the github one under studio"). Every connection therefore
 * carries an address that names all three coordinates an agent needs: the MSO
 * integration (provider), the credential owner (user), and the named connection.
 *
 * The address is the public Integrations URL, so it is also a real navigable route:
 * opening it selects that provider and that owner, and marks the connection.
 */

export type ConnectionCoordinates = {
  provider: string;
  user: string;
  connection: string;
};

/** The query parameters that carry connection coordinates on `/integrations`. */
export const CONNECTION_ADDRESS_PARAMS = ["provider", "user", "connection"] as const;

/** Path only. Callers prepend the origin they actually serve. */
export function connectionAddressPath({ provider, user, connection }: ConnectionCoordinates): string {
  const params = new URLSearchParams({ provider, user, connection });
  return `/integrations?${params.toString()}`;
}

/**
 * Read coordinates back out of a parsed `/integrations` query. Missing or malformed
 * values are dropped rather than defaulted: a half-specified address must not
 * silently resolve to some other owner's account.
 */
export function connectionAddressFrom(params: { get(name: string): string | null }): Partial<ConnectionCoordinates> {
  const pick = (name: string) => {
    const value = params.get(name)?.trim();
    return value ? value : undefined;
  };
  const provider = pick("provider");
  const user = pick("user");
  const connection = pick("connection");
  return { ...(provider ? { provider } : {}), ...(user ? { user } : {}), ...(connection ? { connection } : {}) };
}

/**
 * The short form shown in the card. Full URLs are long and most of the value is in
 * the three coordinates, so the visible text stays compact while Copy emits the
 * absolute address an agent can fetch.
 */
export function connectionAddressLabel({ provider, user, connection }: ConnectionCoordinates): string {
  return `${provider} / ${user} / ${connection}`;
}

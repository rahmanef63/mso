/** Owner-configured endpoint, restricted to an exact local socket and no credentials. */
export function managedAppUpstream(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash)
    throw new Error("upstream target is not loopback");
  return url;
}

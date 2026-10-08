// Curated, client-safe error. lib/host throws HostError for its INTENTIONAL
// messages ("Path outside readable roots", "File too large to read (max 5 MiB)",
// "Access to credential/sensitive files is blocked", ...) — those are UX and
// SHOULD reach the browser. Anything else that escapes a route handler (raw
// Node ENOENT/EACCES errors carrying absolute paths, unexpected exceptions) is
// internal: api-error.ts logs it server-side and returns a generic message.
export class HostError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "HostError";
  }
}

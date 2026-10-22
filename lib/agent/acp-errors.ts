/** Transport/protocol fault carrying the status the API layer should surface. */
export class AcpError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); this.name = "AcpError"; }
}

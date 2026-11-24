/** Transport/protocol fault carrying the status the API layer should surface. */
export class AcpError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; this.name = "AcpError"; }
}

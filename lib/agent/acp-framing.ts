import type { Writable } from "node:stream";
// ACP stdio framing: newline-delimited JSON-RPC, one object per line, plus the write
// path. This layer knows nothing about ids or methods.
//
// Line cap: ACP is one JSON object per line and the biggest real message is a tool
// result or file body (MSO's own agent result budget is 64 KiB), so 1 MiB is generous
// headroom. The cap exists so a runaway agent writing an endless line fails loudly and
// kills the child instead of growing MSO's heap.
export const ACP_MAX_LINE_BYTES = 1_048_576;

/** Incremental newline splitter. Returns the lines found, or signals overflow. */
export class AcpLineReader {
  private buffer = "";
  constructor(private readonly maxLineBytes: number) {}
  /** Feeds one chunk. Calls `onLine` per complete line; returns false when over cap. */
  push(chunk: Buffer, onLine: (line: string) => void): boolean {
    this.buffer += chunk.toString("utf8");
    for (;;) {
      const index = this.buffer.indexOf("\n");
      // An unterminated line past the cap kills the child; it is never truncated.
      if (index < 0) return Buffer.byteLength(this.buffer) <= this.maxLineBytes;
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      if (Buffer.byteLength(line) > this.maxLineBytes) return false;
      if (line.trim()) onLine(line);
    }
  }
}

/** One JSON line on stdin. Throws when the pipe is already gone. */
export function writeAcpLine(stdin: Writable | null | undefined, message: unknown): void {
  if (!stdin || stdin.destroyed) throw new Error("acp_stdin_closed");
  stdin.write(`${JSON.stringify(message)}\n`);
}

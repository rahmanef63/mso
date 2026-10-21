import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// `mso ai` shows the assistant's answer, so the SSE reader must emit exactly the
// reply text and must fail the turn (non-zero) when the route reported an error
// frame. A silent empty success would hide a failed turn behind a clean exit code.
const script = path.join(process.cwd(), "scripts/mso-sse-text.mjs");

function run(input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("scripts/mso-sse-text.mjs", () => {
  it("prints delta text and ends with one newline", async () => {
    const result = await run(
      frame("delta", "Halo ") + frame("delta", "dari MSO") + frame("done", { stopReason: "end_turn" }),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Halo dari MSO\n");
    expect(result.stderr).toBe("");
  });

  it("decodes JSON escapes instead of leaking quoted payloads", async () => {
    const result = await run(frame("delta", 'baris satu\nbaris "dua"') + frame("done", {}));
    expect(result.stdout).toBe('baris satu\nbaris "dua"\n');
  });

  it("tolerates CRLF framing and unknown events", async () => {
    const result = await run(
      'event: delta\r\ndata: "OK"\r\n\r\n' + frame("tool_use", { id: "t1", name: "noop" }) + frame("delta", "!"),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("OK!\n");
  });

  it("fails the turn when the stream reports an error frame", async () => {
    const result = await run(frame("delta", "partial") + frame("error", "provider_unavailable"));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("partial");
    expect(result.stderr).toContain("provider_unavailable");
  });

  it("prints nothing for a reply with no text and still succeeds", async () => {
    const result = await run(frame("done", { stopReason: "end_turn" }));
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("refuses a non-SSE body instead of exiting clean with no reply", async () => {
    const result = await run('{"error":"unexpected"}');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unexpected assistant response");
  });

  it("never reports an empty stream as success", async () => {
    // The HTTP layer already prints its own failure, so this stays quiet on stderr.
    const result = await run("");
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

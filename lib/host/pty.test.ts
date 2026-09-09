// E2E probe for the PTY manager: spawn a real shell, type a command, read the
// echoed output, kill it. Skipped on Windows (node-pty winpty path untested
// here; the product host is Linux).
import { describe, expect, it } from "vitest";
import { attachPty, closePty, hasPty, openPty, writePty } from "./pty";


async function until(cond: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 25));
}

describe("pty session manager", () => {
  it("opens a shell, runs echo, replays buffer, and dies on close", async () => {
    const { id, cwd } = await openPty({ cols: 80, rows: 24 });
    expect(cwd.length).toBeGreaterThan(0);
    expect(hasPty(id)).toBe(true);

    let out = "";
    let exit: number | null = null;
    const detach = attachPty(id, 0, {
      onData: (chunk) => (out += chunk),
      onExit: (code) => (exit = code),
    });

    // $((20+22)) proves the SHELL ran it (the keystroke echo alone still
    // contains the literal "$((20+22))", never the expanded 42).
    writePty(id, "echo pty-e2e-$((20+22))\n");
    await until(() => out.includes("pty-e2e-42"), 8000);
    expect(out).toContain("pty-e2e-42");

    // A second attach from offset 0 must replay the same buffered output.
    let replay = "";
    const detach2 = attachPty(id, 0, { onData: (c) => (replay += c), onExit: () => {} });
    expect(replay).toContain("pty-e2e-42");
    detach2();

    expect(closePty(id)).toBe(true);
    await until(() => exit !== null, 8000);
    expect(exit).not.toBeNull();
    expect(closePty(id)).toBe(false); // idempotent after death
    detach();
  }, 20_000);
});

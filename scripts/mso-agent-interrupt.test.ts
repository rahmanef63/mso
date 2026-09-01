import { describe, expect, it } from "vitest";
import { AgentInterruptManager, isAbortError, makeAbortError } from "./mso-agent-interrupt.mjs";

describe("MSO Agent interrupt semantics", () => {
  it("aborts an active turn on first Ctrl+C and requests exit on a quick second press", () => {
    const chunks: string[] = [];
    let now = 1000;
    const manager = new AgentInterruptManager({
      output: { write: (value: string) => { chunks.push(value); return true; } } as never,
      colors: { warn: "", reset: "", dim: "" },
      now: () => now,
    });
    const signal = manager.beginTurn();
    expect(manager.handleSigint()).toBe("interrupt");
    expect(signal.aborted).toBe(true);
    expect(isAbortError(signal.reason)).toBe(true);
    expect(manager.exitRequested).toBe(false);
    now += 500;
    expect(manager.handleSigint()).toBe("exit");
    expect(manager.exitRequested).toBe(true);
    expect(chunks.join("")).toContain("interrupting turn");
  });

  it("requests a clean exit when SIGINT arrives outside an active turn", () => {
    const manager = new AgentInterruptManager({ output: { write: () => true } as never });
    expect(manager.handleSigint()).toBe("exit");
    expect(manager.exitRequested).toBe(true);
  });

  it("recognizes explicit abort errors", () => {
    expect(isAbortError(makeAbortError())).toBe(true);
    expect(isAbortError(new Error("ordinary"))).toBe(false);
  });
});

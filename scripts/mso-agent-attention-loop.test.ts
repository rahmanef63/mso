import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { BEL } from "./mso-agent-attention.mjs";
import { mountScreenLoop, resumeScreenLoop, suspendScreenLoop } from "./mso-agent-screen-loop.mjs";

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(str: string) {
    this.chunks.push(String(str));
    return true;
  }
}

function makeLoop(options: { attention?: string; getSessions?: () => any[] } = {}) {
  const output = new FakeOutput();
  const session = { agentSession: { id: "s1", name: "active" }, history: [], attention: options.attention };
  const loop = mountScreenLoop({
    enabled: true,
    session,
    output: output as never,
    input: new EventEmitter() as never,
    getSessions: options.getSessions ?? (() => []),
  });
  return { output, session, loop };
}

describe("MSO Agent screen loop attention wiring", () => {
  it("1. setting off writes zero bytes for attention (assert byte-for-byte empty)", () => {
    // Mode off writes strictly zero bytes to dedicated attention sink and terminal stdout.
    const sink = { chunks: [] as string[], write(c: string) { this.chunks.push(c); return true; } };
    let sessions: any[] = [{ id: "s1", status: "idle" }, { id: "s2", status: "idle" }];
    const output = new FakeOutput();
    const session = { agentSession: { id: "s1", name: "active" }, history: [], attention: "off" };
    const loop = mountScreenLoop({
      enabled: true,
      session,
      output: output as never,
      input: new EventEmitter() as never,
      attentionOutput: sink,
      getSessions: () => sessions,
    });

    sessions = [{ id: "s1", status: "idle" }, { id: "s2", status: "working" }];
    loop.sync();

    // Byte-for-byte assertion: attention sink received exactly zero bytes
    expect(sink.chunks.length).toBe(0);
    expect(sink.chunks.join("")).toBe("");

    // Stdout also contains zero BEL alert bytes
    expect(output.chunks.filter((c) => c.includes(BEL))).toEqual([]);
    expect(output.chunks.join("").includes(BEL)).toBe(false);
    loop.dispose();
  });

  it("2. one transition rings exactly once", () => {
    // Mode bell emits exactly one BEL byte when a background session enters attention state.
    let sessions: any[] = [{ id: "s1", status: "idle" }, { id: "s2", status: "idle" }];
    const { output, loop } = makeLoop({ attention: "bell", getSessions: () => sessions });

    loop.sync();
    expect(output.chunks.filter((c) => c === BEL)).toEqual([]);

    sessions = [{ id: "s1", status: "idle" }, { id: "s2", status: "working" }];
    loop.sync();

    // Exactly one BEL byte emitted to terminal output
    expect(output.chunks.filter((c) => c === BEL)).toEqual([BEL]);
    loop.dispose();
  });

  it("3. a second sync with no change rings nothing", () => {
    // Hysteresis prevents bell fatigue: subsequent syncs with same state emit zero bells.
    let sessions: any[] = [{ id: "s1", status: "idle" }, { id: "s2", status: "idle" }];
    const { output, loop } = makeLoop({ attention: "bell", getSessions: () => sessions });

    sessions = [{ id: "s1", status: "idle" }, { id: "s2", status: "working" }];
    loop.sync();
    expect(output.chunks.filter((c) => c === BEL).length).toBe(1);

    // Second sync with identical status emits no additional bell
    loop.sync();
    expect(output.chunks.filter((c) => c === BEL).length).toBe(1);
    loop.dispose();
  });

  it("4. the active session never rings", () => {
    // Active session has user focus so its transitions must never trigger audio bells.
    let sessions: any[] = [{ id: "s1", status: "idle" }, { id: "s2", status: "idle" }];
    const { output, loop } = makeLoop({ attention: "bell", getSessions: () => sessions });

    // Active session s1 transitions to working
    sessions = [{ id: "s1", status: "working" }, { id: "s2", status: "idle" }];
    loop.sync();
    expect(output.chunks.filter((c) => c === BEL)).toEqual([]);

    // Active session s1 transitions to errored
    sessions = [{ id: "s1", status: "errored", error: true }, { id: "s2", status: "idle" }];
    loop.sync();
    expect(output.chunks.filter((c) => c === BEL)).toEqual([]);
    loop.dispose();
  });

  it("5. suspend then resume rings nothing", () => {
    // Leaving alternate screen suppresses bells; resume marks state so return sync stays silent.
    let sessions: any[] = [{ id: "s1", status: "idle" }, { id: "s2", status: "idle" }];
    const { output, loop } = makeLoop({ attention: "bell", getSessions: () => sessions });

    loop.sync();
    suspendScreenLoop(loop);

    sessions = [{ id: "s1", status: "idle" }, { id: "s2", status: "working" }];
    // Sync during suspension is suppressed
    loop.sync();
    expect(output.chunks.filter((c) => c === BEL)).toEqual([]);

    resumeScreenLoop(loop);
    // Sync upon resume is also suppressed
    loop.sync();
    expect(output.chunks.filter((c) => c === BEL)).toEqual([]);

    // Subsequent sync when s2 is still working remains silent
    loop.sync();
    expect(output.chunks.filter((c) => c === BEL)).toEqual([]);
    loop.dispose();
  });
});

// Unit tests for the PTY session-manager guards: session cap, listener-driven
// idle reaping, and slot release on close. We MOCK node-pty so no real shells
// spawn and timing is deterministic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One fake pty per spawn call — we track them so tests can drive lifecycle.
type FakePty = {
  cols: number;
  rows: number;
  cwd: string;
  killed: boolean;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  write: (s: string) => void;
  resize: (c: number, r: number) => void;
  kill: () => void;
  // expose handlers so tests can fire exit synthetically
  _dataCbs: ((d: string) => void)[];
  _exitCbs: ((e: { exitCode: number }) => void)[];
};

const fakePtys: FakePty[] = [];

vi.mock("node-pty", () => ({
  spawn: (_shell: string, _args: string[], opts: { cols: number; rows: number; cwd: string }) => {
    const p: FakePty = {
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      killed: false,
      _dataCbs: [],
      _exitCbs: [],
      onData(cb) {
        this._dataCbs.push(cb);
      },
      onExit(cb) {
        this._exitCbs.push(cb);
      },
      write() {},
      resize(c, r) {
        this.cols = c;
        this.rows = r;
      },
      kill() {
        if (this.killed) return;
        this.killed = true;
        // Real node-pty fires onExit asynchronously after kill().
        queueMicrotask(() => this._exitCbs.forEach((cb) => cb({ exitCode: 0 })));
      },
    };
    fakePtys.push(p);
    return p;
  },
}));

// Reset the globalThis-stashed session map AND the reaper interval between
// tests so a stale session from one test doesn't fill the 8-slot cap in the
// next, and a real-timer reaper from a prior test doesn't tick under fake time.
function resetSessions() {
  const g = globalThis as {
    __osPtySessions?: Map<string, unknown>;
    __osPtyReaper?: ReturnType<typeof setInterval>;
  };
  g.__osPtySessions?.clear();
  if (g.__osPtyReaper) {
    clearInterval(g.__osPtyReaper);
    g.__osPtyReaper = undefined;
  }
  fakePtys.length = 0;
}

beforeEach(() => {
  resetSessions();
});

afterEach(() => {
  resetSessions();
});

async function importPty() {
  // Fresh import so the mock is wired up; the module is cached but the mock
  // applies to every call to node-pty.spawn through it.
  return await import("./pty");
}

describe("PTY session cap", () => {
  it("allows up to 8 concurrent sessions, rejects the 9th", async () => {
    const { openPty } = await importPty();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const { id } = await openPty({ cols: 80, rows: 24 });
      ids.push(id);
    }
    expect(ids).toHaveLength(8);
    await expect(openPty({ cols: 80, rows: 24 })).rejects.toThrow(/Too many terminal sessions/);
  });

  it("releases the slot when a session is closed → next open succeeds", async () => {
    const { openPty, closePty, attachPty } = await importPty();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const { id } = await openPty({ cols: 80, rows: 24 });
      ids.push(id);
    }
    // Capacity is full.
    await expect(openPty({ cols: 80, rows: 24 })).rejects.toThrow(/Too many/);

    // Close one — node-pty's exit fires via queueMicrotask, so attach to learn
    // when the session went dead.
    let exited = false;
    attachPty(ids[0], 0, { onData: () => {}, onExit: () => (exited = true) });
    expect(closePty(ids[0])).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(exited).toBe(true);

    // Cap counts only LIVE (non-dead) sessions → slot freed.
    const { id: id9 } = await openPty({ cols: 80, rows: 24 });
    expect(id9).toBeTruthy();
  });

  it("reclaims the oldest detached shell under capacity pressure after the reconnect grace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const { openPty, attachPty } = await importPty();
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) ids.push((await openPty({ cols: 80, rows: 24 })).id);

      // Seven active streams are protected. Leave only the eighth detached.
      for (const id of ids.slice(0, 7)) attachPty(id, 0, { onData: () => {}, onExit: () => {} });
      await vi.advanceTimersByTimeAsync(11_000);

      const { id: replacement } = await openPty({ cols: 80, rows: 24 });
      expect(replacement).toBeTruthy();
      expect(fakePtys[7]!.killed).toBe(true);
      expect(fakePtys.slice(0, 7).every((pty) => !pty.killed)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never reclaims an attached shell even when every slot is old", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const { openPty, attachPty } = await importPty();
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) ids.push((await openPty({ cols: 80, rows: 24 })).id);
      for (const id of ids) attachPty(id, 0, { onData: () => {}, onExit: () => {} });
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(openPty({ cols: 80, rows: 24 })).rejects.toThrow(/Too many terminal sessions/);
      expect(fakePtys.every((pty) => !pty.killed)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closePty is idempotent + returns false on a dead session", async () => {
    const { openPty, closePty } = await importPty();
    const { id } = await openPty({ cols: 80, rows: 24 });
    expect(closePty(id)).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(closePty(id)).toBe(false);
  });
});

describe("PTY idle reaper", () => {
  it("kills a session with no listeners after the idle window, fires onExit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    try {
      const { openPty, attachPty } = await importPty();
      const { id } = await openPty({ cols: 80, rows: 24 });

      // Attach + detach so listeners.size === 0 → idle clock starts now.
      const detach = attachPty(id, 0, { onData: () => {}, onExit: () => {} });
      detach();

      // The reaper ticks once a minute. Push past the 30-min idle threshold.
      await vi.advanceTimersByTimeAsync(31 * 60_000);

      // Session was killed → fake pty's onExit (queueMicrotask) marks it dead.
      // A fresh attach on a dead session replays exit immediately.
      let replayExit: number | null = null;
      attachPty(id, 0, { onData: () => {}, onExit: (c) => (replayExit = c) });
      expect(replayExit).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT reap a session while a listener is attached, even past the window", async () => {
    vi.useFakeTimers();
    try {
      const { openPty, attachPty, closePty } = await importPty();
      const { id } = await openPty({ cols: 80, rows: 24 });
      let exit: number | null = null;
      attachPty(id, 0, { onData: () => {}, onExit: (c) => (exit = c) });

      // Push past the idle window — but the listener pins it.
      vi.advanceTimersByTime(60 * 60_000);
      expect(exit).toBeNull();

      // Manual close still works.
      expect(closePty(id)).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(exit).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

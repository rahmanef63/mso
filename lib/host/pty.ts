// SERVER-ONLY. Interactive PTY session manager behind /api/v1/term/*. Spawns
// the owner's login shell on the host and streams raw bytes both ways (vim,
// top, ssh, tab-completion — anything a real terminal does).
//
// SECURITY: this is an interactive OWNER shell — the destructive-command regex
// in exec.ts CANNOT apply here. A pty carries raw keystrokes with no command
// boundary to inspect, and an interactive shell composes commands from
// fragments (history, completion, editors) anyway. The gate is the same as
// every /api/v1 route: signed session cookie + approved device. Session
// open/close are audited (term.open / term.close); keystrokes are not
// (high-volume, and the owner has a full shell by design).
import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import { randomBytes } from "crypto";
import { HostError } from "./host-error";
import { resolveCwd } from "./exec";
import { childEnv } from "./child-env";

const MAX_SESSIONS = 8; // concurrent live shells
const BUFFER_CAP = 256 * 1024; // chars of replay buffer per session
const IDLE_REAP_MS = 30 * 60_000; // no attached client for 30 min → kill
// Hard browser/process exits cannot reliably send /term/close. If all eight slots are
// occupied, a shell that has had NO stream listener for this long is safe to reclaim
// under capacity pressure. The grace is deliberately longer than EventSource's normal
// reconnect window, and attached shells are never candidates.
const CAPACITY_RECLAIM_GRACE_MS = 10_000;
const DEAD_LINGER_MS = 60_000; // exited sessions linger so streams deliver `exit`
const REAP_TICK_MS = 60_000;

export type PtyListener = {
  /** `offset` = absolute stream position AFTER the chunk. Used as the SSE
   * event id so a Last-Event-ID reconnect resumes exactly where it left off. */
  onData: (chunk: string, offset: number) => void;
  onExit: (code: number) => void;
};

type Session = {
  id: string;
  pty: IPty;
  /** Replay ring: recent output chunks with absolute start offsets. */
  chunks: { off: number; data: string }[];
  buffered: number;
  offset: number; // total chars ever emitted
  listeners: Set<PtyListener>;
  dead: boolean;
  exitCode: number;
  idleSince: number; // last moment with zero listeners (or exit time)
};

// globalThis stash so dev-mode HMR module reloads don't orphan live shells.
// A full server restart still drops every session (clients see the stream die
// and get a Restart button) — sessions are processes, not persistable state.
const g = globalThis as {
  __osPtySessions?: Map<string, Session>;
  __osPtyReaper?: ReturnType<typeof setInterval>;
};
const sessions = (g.__osPtySessions ??= new Map<string, Session>());

function ensureReaper(): void {
  if (g.__osPtyReaper) return;
  g.__osPtyReaper = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (!s.dead && s.listeners.size === 0 && now - s.idleSince > IDLE_REAP_MS)
        s.pty.kill(); // onExit marks it dead; lingers below until cleaned
      if (s.dead && s.listeners.size === 0 && now - s.idleSince > DEAD_LINGER_MS)
        sessions.delete(s.id);
    }
  }, REAP_TICK_MS);
  g.__osPtyReaper.unref?.();
}

function get(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new HostError("Unknown terminal session");
  return s;
}

function clampDim(n: number): number {
  return Math.max(2, Math.min(500, Math.round(n)));
}

function reclaimDetachedSlot(now = Date.now()): boolean {
  let candidate: Session | null = null;
  for (const session of sessions.values()) {
    if (session.dead || session.listeners.size > 0) continue;
    if (now - session.idleSince < CAPACITY_RECLAIM_GRACE_MS) continue;
    if (!candidate || session.idleSince < candidate.idleSince) candidate = session;
  }
  if (!candidate) return false;

  // Delete first so the slot is immediately available even though node-pty emits its
  // exit callback asynchronously. A late reconnect to the reclaimed id correctly gets
  // “Unknown terminal session” and the client can Restart instead of reviving a shell
  // we deliberately evicted under capacity pressure.
  sessions.delete(candidate.id);
  candidate.pty.kill();
  return true;
}

export async function openPty(opts: {
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<{ id: string; cwd: string }> {
  let live = 0;
  for (const s of sessions.values()) if (!s.dead) live++;
  if (live >= MAX_SESSIONS && !reclaimDetachedSlot())
    throw new HostError(`Too many terminal sessions (max ${MAX_SESSIONS}) — close one first`);

  const cwd = await resolveCwd(opts.cwd); // write-root bounded, falls back home
  const shell = process.env.SHELL || "/bin/bash";
  const env = childEnv(); // process.env minus the app's own secrets
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";

  const pty = spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols: clampDim(opts.cols),
    rows: clampDim(opts.rows),
    cwd,
    env,
  });
  const s: Session = {
    id: randomBytes(16).toString("hex"),
    pty,
    chunks: [],
    buffered: 0,
    offset: 0,
    listeners: new Set(),
    dead: false,
    exitCode: 0,
    idleSince: Date.now(),
  };
  pty.onData((data) => {
    s.chunks.push({ off: s.offset, data });
    s.offset += data.length;
    s.buffered += data.length;
    while (s.buffered > BUFFER_CAP && s.chunks.length > 1) {
      const drop = s.chunks.shift();
      if (drop) s.buffered -= drop.data.length;
    }
    for (const l of s.listeners) l.onData(data, s.offset);
  });
  pty.onExit(({ exitCode }) => {
    s.dead = true;
    s.exitCode = exitCode;
    s.idleSince = Date.now();
    for (const l of s.listeners) l.onExit(exitCode);
  });
  sessions.set(s.id, s);
  ensureReaper();
  return { id: s.id, cwd };
}

/** True when the session id exists (live or recently exited). */
export function hasPty(id: string): boolean {
  return sessions.has(id);
}

// Attach a stream: replay buffered output past `fromOffset` synchronously,
// then live events. A dead session replays + fires onExit immediately.
// Returns the detach fn (idle-reap clock starts when the last client leaves).
export function attachPty(id: string, fromOffset: number, l: PtyListener): () => void {
  const s = get(id);
  const from = Math.max(0, Math.min(fromOffset, s.offset));
  for (const c of s.chunks) {
    const end = c.off + c.data.length;
    if (end <= from) continue;
    l.onData(c.off >= from ? c.data : c.data.slice(from - c.off), end);
  }
  if (s.dead) {
    l.onExit(s.exitCode);
    return () => {};
  }
  s.listeners.add(l);
  return () => {
    s.listeners.delete(l);
    if (s.listeners.size === 0) s.idleSince = Date.now();
  };
}

export function writePty(id: string, data: string): void {
  const s = get(id);
  if (s.dead) throw new HostError("Terminal session has exited");
  s.pty.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const s = get(id);
  if (s.dead) throw new HostError("Terminal session has exited");
  s.pty.resize(clampDim(cols), clampDim(rows));
}

// Idempotent close: the client fires close-on-unmount even after the shell
// already exited. Returns whether a live shell was actually killed (audit
// only logs a real kill).
export function closePty(id: string): boolean {
  const s = sessions.get(id);
  if (!s || s.dead) return false;
  s.pty.kill();
  return true;
}

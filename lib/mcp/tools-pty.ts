import { createHash } from "crypto";
import { attachPty, closePty, hasPty, openPty, writePty } from "@/lib/host/terminal-api";
import { opt, S, str, type McpTool } from "./tool-kit";
import { requireWorkflowExecCwd } from "./workflow-workspace-guard";

const PROMPT_REGEX = /(?:password:|passphrase|sudo password|\[sudo\])/i;
const sessionCreatedAt = new Map<string, number>();

function listSessions(owner: string) {
  const g = globalThis as {
    __osPtySessions?: Map<string, { id: string; ownerHash: string; dead: boolean; exitCode: number }>;
  };
  const sessions = g.__osPtySessions;
  if (!sessions) return { sessions: [] };
  const hash = createHash("sha256").update(owner).digest("hex");
  const list: Array<{ sessionId: string; createdAt?: number; dead: boolean; exitCode?: number }> = [];
  for (const s of sessions.values()) {
    if (s.ownerHash === hash) {
      list.push({
        sessionId: s.id,
        ...(sessionCreatedAt.has(s.id) ? { createdAt: sessionCreatedAt.get(s.id) } : {}),
        dead: Boolean(s.dead),
        ...(s.dead ? { exitCode: s.exitCode } : {}),
      });
    }
  }
  return { sessions: list };
}

function readSession(sessionId: string, owner: string, sinceOffset: number, maxBytes: number) {
  let output = "";
  let nextOffset = sinceOffset;
  let truncated = false;
  let exited: boolean | undefined;
  let exitCode: number | undefined;

  const detach = attachPty(sessionId, owner, sinceOffset, {
    onData: (chunk, end) => {
      if (truncated) return;
      const chunkStart = end - chunk.length;
      const remaining = maxBytes - output.length;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length <= remaining) {
        output += chunk;
        nextOffset = end;
      } else {
        output += chunk.slice(0, remaining);
        nextOffset = chunkStart + remaining;
        truncated = true;
      }
    },
    onExit: (code) => {
      exited = true;
      exitCode = code;
    },
  });
  detach();

  const promptSuspected = PROMPT_REGEX.test(output);
  return {
    output,
    nextOffset,
    truncated,
    ...(exited !== undefined ? { exited, exitCode } : {}),
    ...(promptSuspected ? { promptSuspected: true } : {}),
  };
}

const PTY_INPUT_PROPERTIES = {
  action: {
    type: "string",
    enum: ["open", "write", "read", "list", "close"],
    description: "PTY action: open, write, read, list, or close.",
  },
  sessionId: { type: "string", description: "Terminal session identifier." },
  cwd: { type: "string", description: "Working directory for open. Defaults to owner home." },
  cols: { type: "number", description: "Terminal columns for open. Default 120." },
  rows: { type: "number", description: "Terminal rows for open. Default 30." },
  data: { type: "string", description: "Input characters or bytes for write. Maximum 4 KiB." },
  max_bytes: { type: "number", description: "Maximum output bytes to read. Default 8192, cap 32768." },
  since_offset: { type: "number", description: "Absolute replay offset for read. Default 0." },
};

export const PTY_TOOLS: McpTool[] = [
  {
    name: "pty_session",
    title: "Interactive Terminal Session",
    scope: "exec",
    limit: {
      key: "term.open",
      max: 20,
      windowMs: 60_000,
      actionLimits: {
        write: { max: 120, windowMs: 60_000 },
        read: { max: 240, windowMs: 60_000 },
        list: { max: 60, windowMs: 60_000 },
        close: { max: 60, windowMs: 60_000 },
      },
    },
    audit: {
      action: "term.open" as const,
      targetArg: "sessionId",
      outcome: (r) => {
        const res = r as { sessionId?: string; closed?: boolean; bytesWritten?: number } | undefined;
        if (res?.closed !== undefined) return { ok: true, action: "term.close", detail: `closed: ${res.closed}` };
        if (res?.sessionId) return { ok: true, action: "term.open", detail: `session ${res.sessionId.slice(0, 8)}` };
        // Keystrokes are their own forensic event: "opened a shell" and "typed a command
        // into a shell" are not the same act, and collapsing them hides the second one.
        if (typeof res?.bytesWritten === "number") return { ok: true, action: "term.write", detail: `wrote ${res.bytesWritten}b` };
        return { ok: true, action: "term.open" };
      },
    },
    actionContract: {
      phase: "execute",
      target: "terminal-pty",
      sourceOfTruth: "live",
      confirmation: "contextual",
      presentation: "structured",
    },
    description:
      "Interactive PTY session for commands requiring a real terminal. Bounded polling over absolute-offset replay ring. Actions: open, write, read, list, close.",
    annotations: { destructiveHint: true, openWorldHint: true },
    result: {
      maxTextBytes: 48 * 1024,
      overflowHint: "PTY output is polled with max_bytes and since_offset; read next chunk if truncated.",
    },
    inputSchema: S(PTY_INPUT_PROPERTIES, ["action"]),
    run: async (a, context) => {
      const owner = context.principal ?? context.workflowActor ?? context.actor;
      if (!owner) throw new Error("principal is required");
      const action = a.action;
      if (action === "open") {
        const cols = typeof a.cols === "number" && a.cols > 0 ? a.cols : 120;
        const rows = typeof a.rows === "number" && a.rows > 0 ? a.rows : 30;
        const cwd = opt(a, "cwd");
        await requireWorkflowExecCwd(context, cwd);
        const { id } = await openPty({ cols, rows, cwd, owner });
        sessionCreatedAt.set(id, Date.now());
        return { sessionId: id, cols, rows };
      }
      if (action === "write") {
        const sessionId = str(a, "sessionId");
        if (typeof a.data !== "string") throw new Error("data must be a string");
        const byteLen = Buffer.byteLength(a.data, "utf8");
        if (byteLen > 4096) throw new Error("data exceeds 4 KiB limit");
        writePty(sessionId, owner, a.data);
        return { ok: true, bytesWritten: byteLen };
      }
      if (action === "read") {
        const sessionId = str(a, "sessionId");
        const requestedMax = typeof a.max_bytes === "number" && a.max_bytes > 0 ? a.max_bytes : 8192;
        const maxBytes = Math.min(requestedMax, 32768);
        const sinceOffset = typeof a.since_offset === "number" && a.since_offset >= 0 ? a.since_offset : 0;
        return readSession(sessionId, owner, sinceOffset, maxBytes);
      }
      if (action === "list") {
        return listSessions(owner);
      }
      if (action === "close") {
        const sessionId = str(a, "sessionId");
        if (!hasPty(sessionId, owner)) throw new Error(`Unknown terminal session`);
        const closed = closePty(sessionId, owner);
        return { ok: true, closed };
      }
      throw new Error("action must be open, write, read, list, or close");
    },
  },
];

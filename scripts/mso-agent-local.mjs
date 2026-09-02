import { randomUUID } from "node:crypto";
import process from "node:process";
import { api, apiResponse, C } from "./mso-agent-runtime.mjs";
import { persistSession } from "./mso-agent-session-ui.mjs";

const HEARTBEAT_MS = 20_000;
const RECONNECT_MIN_MS = 800;
const RECONNECT_MAX_MS = 5_000;

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function agentPrefix(label) {
  const clean = String(label || "[agent]").replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\[|\]$/g, "");
  return clean.startsWith("agent-") ? `[${clean}]` : `[agent-${clean}]`;
}

export function formatLocalAgentEvent(message, colors = C) {
  const prefix = agentPrefix(message?.senderLabel);
  const kind = message?.kind === "task" ? " task" : "";
  const text = String(message?.text || "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const indented = text.replace(/\n/g, "\n  ");
  return `${colors.c}${colors.bold}${prefix}${kind}${colors.reset} ${indented}`;
}

function historyRow(message) {
  return {
    role: "agent",
    text: String(message.text || ""),
    senderSessionId: message.senderSessionId,
    senderLabel: message.senderLabel,
    kind: message.kind === "task" ? "task" : "message",
    messageId: message.id,
    createdAt: message.createdAt,
  };
}

export class LocalAgentBridge {
  constructor({ session, composer }) {
    this.session = session;
    this.composer = composer;
    this.instanceId = `cli:${process.pid}:${randomUUID()}`;
    this.sessionId = null;
    this.state = "idle";
    this.closed = false;
    this.feedAbort = null;
    this.heartbeat = null;
    this.feedTask = null;
    this.pending = [];
    this.seen = new Set();
  }

  async start() {
    await this.syncSession();
    this.heartbeat = setInterval(() => void this.touch({ flush: false }).catch(() => undefined), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  async syncSession() {
    const next = String(this.session?.agentSession?.id || "").trim();
    if (!next || next === this.sessionId) return;
    const previous = this.sessionId;
    if (previous) await this.end(previous).catch(() => undefined);
    this.feedAbort?.abort();
    this.feedAbort = null;
    this.sessionId = next;
    this.state = "ready";
    this.pending = [];
    this.seen = new Set(
      (Array.isArray(this.session.history) ? this.session.history : [])
        .filter((row) => row?.role === "agent" && row?.messageId)
        .map((row) => String(row.messageId)),
    );
    await this.touch().catch(() => undefined);
    this.state = "idle";
    await this.touch().catch(() => undefined);
    this.startFeed(next);
  }

  async setState(state) {
    if (this.closed || !this.sessionId) return;
    this.state = state === "busy" ? "busy" : "idle";
    await this.touch().catch(() => undefined);
    if (this.state === "idle" && this.pending.length) {
      const rows = this.pending.splice(0);
      for (const row of rows) await this.accept(row);
    }
  }

  async touch({ flush = true } = {}) {
    if (this.closed || !this.sessionId) return;
    await api("/api/v1/local-agents", {
      method: "POST",
      body: JSON.stringify({
        action: "presence",
        sessionId: this.sessionId,
        instanceId: this.instanceId,
        state: this.state,
        flush,
      }),
    });
  }

  async end(sessionId = this.sessionId) {
    if (!sessionId) return;
    await api("/api/v1/local-agents", {
      method: "POST",
      body: JSON.stringify({ action: "end", sessionId, instanceId: this.instanceId }),
    });
  }

  startFeed(sessionId) {
    const controller = new AbortController();
    this.feedAbort = controller;
    this.feedTask = this.feedLoop(sessionId, controller.signal).catch(() => undefined);
  }

  async feedLoop(sessionId, signal) {
    let delay = RECONNECT_MIN_MS;
    while (!this.closed && !signal.aborted && this.sessionId === sessionId) {
      try {
        const res = await apiResponse(`/api/v1/local-agents?stream=1&session=${encodeURIComponent(sessionId)}`, { signal });
        if (!res.body) throw new Error("local agent event stream is unavailable");
        await this.touch({ flush: false }).catch(() => undefined);
        delay = RECONNECT_MIN_MS;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            let event = "message", data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (event !== "message" || !data) continue;
            const message = JSON.parse(data);
            if (this.state === "busy") this.pending.push(message);
            else await this.accept(message);
          }
        }
      } catch {
        if (signal.aborted || this.closed) return;
      }
      if (!signal.aborted && !this.closed) {
        await sleep(delay, signal);
        delay = Math.min(RECONNECT_MAX_MS, delay * 2);
      }
    }
  }

  async accept(message) {
    if (!message?.id || this.seen.has(String(message.id))) {
      if (message?.id) await this.ack([String(message.id)]).catch(() => undefined);
      return;
    }
    if (String(message.targetSessionId || "") !== this.sessionId) return;
    const id = String(message.id);
    const alreadyStored = this.session.history.some((row) => row?.role === "agent" && String(row?.messageId || "") === id);
    if (!alreadyStored) this.session.history.push(historyRow(message));
    await persistSession(this.session);
    this.seen.add(id);
    if (!alreadyStored) this.composer.notify(formatLocalAgentEvent(message));
    await this.ack([id]).catch(() => undefined);
  }

  async ack(messageIds) {
    if (!this.sessionId || !messageIds.length) return;
    await api("/api/v1/local-agents", {
      method: "POST",
      body: JSON.stringify({ action: "ack", sessionId: this.sessionId, messageIds }),
    });
  }

  async close({ ended = true } = {}) {
    if (this.closed) return;
    if (ended) await this.end().catch(() => undefined);
    this.closed = true;
    this.feedAbort?.abort();
    if (this.heartbeat) clearInterval(this.heartbeat);
  }
}

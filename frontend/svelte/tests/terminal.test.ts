import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, closeTerminal, openTerminal, resizeTerminal, sendTerminalInput, terminalStreamUrl } from "../src/lib/terminal/term-api.ts";
import {
  MAX_OUTPUT_CHARS, appendTerminalOutput, createTerminalController, decodeBase64Utf8,
  sanitizeTerminalOutput, type EventSourceLike, type TerminalState,
} from "../src/lib/terminal/term-controller.ts";

const signal = new AbortController().signal;
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: string;
  readonly init?: { withCredentials?: boolean };
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  constructor(url: string, init?: { withCredentials?: boolean }) { this.url = url; this.init = init; }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emitOpen() { this.readyState = 1; this.onopen?.(new Event("open")); }
  emitEvent(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent<string>);
  }
  emitError(closed: boolean) { this.readyState = closed ? 2 : 0; this.onerror?.(new Event("error")); }
  close() { this.closed = true; this.readyState = 2; }
}

test("term-api matches real MSO PTY endpoints, validates JSON fail-closed, and supports desktop bridge", async () => {
  const calls: Array<{ url: string; body: unknown; creds: unknown; keepalive?: boolean }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, creds: init?.credentials, keepalive: init?.keepalive });
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    return url.endsWith("/open") ? Response.json({ id: "pty-abc" }) : Response.json({ ok: true });
  };
  assert.equal((await openTerminal({ cols: 100, rows: 30, cwd: "/srv" }, signal, fetcher)).id, "pty-abc");
  await sendTerminalInput("pty-abc", "ls -la\r", signal, fetcher);
  await resizeTerminal("pty-abc", 120, 40, signal, fetcher);
  await closeTerminal("pty-abc", signal, fetcher, undefined, true);
  assert.deepEqual(calls.map((c) => c.url), ["/api/v1/term/open", "/api/v1/term/input", "/api/v1/term/resize", "/api/v1/term/close"]);
  assert.deepEqual(calls[0].body, { cols: 100, rows: 30, cwd: "/srv" });
  assert.deepEqual(calls[1].body, { id: "pty-abc", data: "ls -la\r" });
  assert.deepEqual(calls[2].body, { id: "pty-abc", cols: 120, rows: 40 });
  assert.deepEqual(calls[3].body, { id: "pty-abc" });
  assert.equal(calls[3].keepalive, true);
  assert.equal(calls[0].creds, "same-origin");

  const bridge = { surface: "tauri-desktop" as const, apiBaseOrigin: "http://127.0.0.1:3000" };
  assert.equal(terminalStreamUrl("pty/1", bridge), "http://127.0.0.1:3000/api/v1/term/stream?id=pty%2F1");
  await assert.rejects(openTerminal({}, signal, async () => Response.json({ id: "" })), /open response is invalid/);
  await assert.rejects(sendTerminalInput("pty-1", "x", signal, async () => Response.json({ ok: false })), /response is invalid/);
  await assert.rejects(
    openTerminal({}, signal, async () => new Response("<html>err</html>", { headers: { "Content-Type": "text/html" } })),
    /API is unavailable/,
  );
});

test("term-api maps 401, 403, 429, and 5xx safely without leaking raw upstream errors", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(
      openTerminal({}, signal, async () => Response.json({ error: "secret internal stack trace" }, { status })),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, status);
        assert.ok(!err.message.includes("secret internal"));
        if (status === 403) assert.match(err.message, /Owner role/i);
        if (status === 401) assert.match(err.message, /session/i);
        return true;
      },
    );
  }
});

test("ANSI stripping, UTF-8 base64 decoding, and 64 KiB output buffer capping", () => {
  const raw = "\x1b]0;user@host:~\x07\x1b[32mhello\x1b[0m \x1b[1;34mworld\x1b[0m\r\nline2\x07\x00\tindented";
  assert.equal(sanitizeTerminalOutput(raw), "hello world\nline2\tindented");
  assert.equal(decodeBase64Utf8(b64("caf\u00e9 \u2713")), "caf\u00e9 \u2713");
  assert.equal(decodeBase64Utf8("!!!invalid-base64!!!"), "");

  const big = "a".repeat(MAX_OUTPUT_CHARS - 4);
  const capped = appendTerminalOutput(big, "\x1b[31m12345678\x1b[0m");
  assert.equal(capped.length, MAX_OUTPUT_CHARS);
  assert.ok(capped.endsWith("12345678"));
  assert.ok(capped.startsWith("aaaa"));
});

test("term-controller streams base64 SSE data, sends input, handles exit/error, and closes on dispose", async () => {
  const states: TerminalState[] = [];
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const sources: FakeEventSource[] = [];
  const bridge = { surface: "tauri-desktop" as const, apiBaseOrigin: "http://127.0.0.1:3000" };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return url.endsWith("/open") ? Response.json({ id: `pty-${sources.length + 1}` }) : Response.json({ ok: true });
  };
  const ctrl = createTerminalController((s) => states.push(s), {
    fetcher,
    bridge,
    createEventSource: (url, init) => { const es = new FakeEventSource(url, init); sources.push(es); return es; },
  });

  await ctrl.connect("/srv/app");
  assert.equal(sources[0].url, "http://127.0.0.1:3000/api/v1/term/stream?id=pty-1");
  assert.deepEqual(sources[0].init, { withCredentials: true });
  sources[0].emitOpen();
  assert.equal(states.at(-1)?.status, "connected");
  sources[0].emitEvent("data", b64("\x1b[32mready$\x1b[0m \r\n"));
  assert.equal(states.at(-1)?.output, "ready$ \n");

  await ctrl.sendLine("echo hi");
  await ctrl.sendRaw("\x03");
  assert.deepEqual(requests.slice(1).map((r) => r.body), [{ id: "pty-1", data: "echo hi\r" }, { id: "pty-1", data: "\x03" }]);
  ctrl.clearOutput();
  assert.equal(states.at(-1)?.output, "");

  sources[0].emitEvent("exit", "0");
  assert.equal(sources[0].closed, true);
  assert.equal(states.at(-1)?.status, "closed");
  assert.equal(states.at(-1)?.exitCode, 0);

  await ctrl.connect();
  sources[1].emitOpen();
  sources[1].emitError(true);
  assert.equal(states.at(-1)?.status, "error");

  await ctrl.connect();
  sources[2].emitOpen();
  const beforeDispose = states.length;
  ctrl.dispose();
  assert.equal(sources[2].closed, true);
  sources[2].emitEvent("data", b64("ignored after dispose"));
  assert.equal(states.length, beforeDispose);
  assert.deepEqual(requests.filter((r) => r.url.endsWith("/close")).at(-1)?.body, { id: "pty-3" });
});

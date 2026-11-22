import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { ApiError, closeTerminal, openTerminal, resizeTerminal, sendTerminalInput, terminalStreamUrl } from "./term-api.ts";

export type TerminalStatus = "idle" | "connecting" | "connected" | "closed" | "error";
export type TerminalState = {
  status: TerminalStatus; sessionId: string | null; output: string;
  exitCode: number | null; error: string | null; errorStatus: number | null; sending: boolean;
};
export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
};
export type EventSourceFactory = (url: string, init?: { withCredentials?: boolean }) => EventSourceLike;
export type TerminalControllerOptions = {
  fetcher?: typeof fetch; bridge?: ShellBridge; createEventSource?: EventSourceFactory;
  cols?: number; rows?: number;
};

export const MAX_OUTPUT_CHARS = 65_536;
const ES_CLOSED = 2;
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][\s\S]*?\x1b\\|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
const CTRL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;
const defaultEventSource: EventSourceFactory = (url, init) => new EventSource(url, init);

export function decodeBase64Utf8(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(atob(trimmed), (ch) => ch.charCodeAt(0)));
  } catch {
    return "";
  }
}

export function sanitizeTerminalOutput(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r\n/g, "\n").replace(CTRL_RE, "");
}

export function appendTerminalOutput(current: string, chunk: string, maxChars = MAX_OUTPUT_CHARS): string {
  const next = current + sanitizeTerminalOutput(chunk);
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}

export function initialTerminalState(): TerminalState {
  return { status: "idle", sessionId: null, output: "", exitCode: null, error: null, errorStatus: null, sending: false };
}

export function createTerminalController(
  update: (state: TerminalState) => void,
  options: TerminalControllerOptions = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const createEs = options.createEventSource ?? defaultEventSource;
  const cols = options.cols ?? 80, rows = options.rows ?? 24;
  let state: TerminalState = initialTerminalState();
  let gen = 0, disposed = false;
  let stream: EventSourceLike | null = null;
  let openAbort: AbortController | undefined, inputAbort: AbortController | undefined;

  const getBridge = () => options.bridge ?? detectShellBridge();
  const emit = (patch: Partial<TerminalState>) => { state = { ...state, ...patch }; if (!disposed) update(state); };
  const closeRemote = (id: string | null) =>
    id ? closeTerminal(id, undefined, fetcher, getBridge(), true).catch(() => {}) : Promise.resolve();

  function teardownLocal(): string | null {
    openAbort?.abort();
    inputAbort?.abort();
    stream?.close();
    stream = null;
    const prevId = state.sessionId;
    state = { ...state, sessionId: null, sending: false };
    return prevId;
  }

  function attachStream(es: EventSourceLike, run: number) {
    stream = es;
    es.onopen = () => { if (!disposed && run === gen) emit({ status: "connected", error: null, errorStatus: null }); };
    es.addEventListener("data", (event) => {
      if (disposed || run !== gen) return;
      const chunk = decodeBase64Utf8(String(event.data ?? ""));
      emit({ status: state.status === "connecting" ? "connected" : state.status, output: appendTerminalOutput(state.output, chunk) });
    });
    es.addEventListener("exit", (event) => {
      es.close();
      if (disposed || run !== gen) return;
      stream = null;
      const code = Number.parseInt(String(event.data ?? ""), 10);
      emit({ status: "closed", sessionId: null, exitCode: Number.isNaN(code) ? null : code, sending: false });
    });
    es.onerror = () => {
      if (disposed || run !== gen) return;
      if (es.readyState !== ES_CLOSED) { emit({ status: "connecting" }); return; }
      es.close();
      stream = null;
      emit({ status: "error", error: "Terminal stream disconnected. Reconnect to start a new session.", errorStatus: null });
    };
  }

  async function connect(cwd?: string): Promise<void> {
    if (disposed) return;
    const run = ++gen;
    void closeRemote(teardownLocal());
    emit({ status: "connecting", sessionId: null, exitCode: null, error: null, errorStatus: null, sending: false });
    const ctrl = (openAbort = new AbortController());
    try {
      const bridge = getBridge();
      const { id } = await openTerminal({ cols, rows, cwd }, ctrl.signal, fetcher, bridge);
      if (disposed || run !== gen) { void closeRemote(id); return; }
      emit({ status: "connecting", sessionId: id });
      attachStream(createEs(terminalStreamUrl(id, bridge), bridge.apiBaseOrigin ? { withCredentials: true } : undefined), run);
    } catch (error) {
      if (disposed || run !== gen || ctrl.signal.aborted) return;
      emit({
        status: "error", sessionId: null,
        error: error instanceof ApiError ? error.message : "Could not open terminal session. Check the backend and retry.",
        errorStatus: error instanceof ApiError ? error.status : null,
      });
    }
  }

  async function sendRaw(data: string): Promise<void> {
    if (disposed || !state.sessionId || state.status !== "connected") return;
    const run = gen, id = state.sessionId, ctrl = (inputAbort = new AbortController());
    emit({ sending: true, error: null, errorStatus: null });
    try {
      await sendTerminalInput(id, data, ctrl.signal, fetcher, getBridge());
      if (!disposed && run === gen) emit({ sending: false });
    } catch (error) {
      if (disposed || run !== gen || ctrl.signal.aborted) return;
      emit({
        sending: false,
        error: error instanceof ApiError ? error.message : "Failed to send input to the terminal.",
        errorStatus: error instanceof ApiError ? error.status : null,
      });
    }
  }

  return {
    connect, sendLine: (text: string) => sendRaw(`${text}\r`), sendRaw,
    resize: (c: number, r: number) =>
      disposed || !state.sessionId ? Promise.resolve() : resizeTerminal(state.sessionId, c, r, undefined, fetcher, getBridge()).catch(() => {}),
    clearOutput: () => { if (!disposed) emit({ output: "" }); },
    async disconnect(): Promise<void> {
      if (disposed) return;
      gen++;
      const prevId = teardownLocal();
      emit({ status: "closed", sessionId: null, exitCode: null, error: null, errorStatus: null, sending: false });
      await closeRemote(prevId);
    },
    dispose(): void { if (disposed) return; disposed = true; gen++; void closeRemote(teardownLocal()); },
  };
}

import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type OpenTerminalOptions = { cols?: number; rows?: number; cwd?: string };
export type OpenTerminalResult = { id: string };

const MIN_DIM = 2, MAX_DIM = 500, DEFAULT_COLS = 80, DEFAULT_ROWS = 24, TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDim(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DIM && value <= MAX_DIM;
}

function requireSessionId(id: string): string {
  if (typeof id !== "string" || !id.trim()) throw new ApiError("Terminal session ID is required.", 400);
  return id;
}

function statusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable or expired. Sign in to use the terminal.";
  if (status === 403) return "Owner role is required to open or control the host terminal.";
  if (status === 400) return "Terminal session is invalid or no longer active.";
  if (status === 404) return "Terminal session or endpoint was not found.";
  if (status === 429) return "Too many terminal requests. Wait a moment and retry.";
  if (status >= 500) return `MSO terminal service error (${status}). Retry in a moment.`;
  return `MSO terminal API request failed (${status}).`;
}

async function postTermJson(
  path: string,
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
  bridge: ShellBridge,
  keepalive = false,
): Promise<unknown> {
  const reqSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: "POST",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: reqSignal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    ...(keepalive ? { keepalive: true } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  try {
    return await response.json();
  } catch {
    throw new ApiError("The MSO terminal API returned invalid JSON.", 502);
  }
}

function requireOk(body: unknown): void {
  if (!isRecord(body) || body.ok !== true) throw new ApiError("The MSO terminal response is invalid.", 502);
}

export function terminalStreamUrl(id: string, bridge: ShellBridge = detectShellBridge()): string {
  const query = new URLSearchParams({ id: requireSessionId(id) }).toString();
  return resolveApiUrl(`/api/v1/term/stream?${query}`, bridge);
}

export async function openTerminal(
  options: OpenTerminalOptions = {},
  signal?: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<OpenTerminalResult> {
  const cols = options.cols ?? DEFAULT_COLS;
  const rows = options.rows ?? DEFAULT_ROWS;
  if (!validDim(cols) || !validDim(rows)) throw new ApiError("Terminal dimensions must be integers between 2 and 500.", 400);
  if (options.cwd !== undefined && typeof options.cwd !== "string") {
    throw new ApiError("Terminal working directory must be a string.", 400);
  }
  const payload: Record<string, unknown> = options.cwd ? { cols, rows, cwd: options.cwd } : { cols, rows };
  const body = await postTermJson("/api/v1/term/open", payload, signal, fetcher, bridge);
  if (!isRecord(body) || typeof body.id !== "string" || !body.id.trim()) {
    throw new ApiError("The MSO terminal open response is invalid.", 502);
  }
  return { id: body.id };
}

export async function sendTerminalInput(
  id: string,
  data: string,
  signal?: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  if (typeof data !== "string") throw new ApiError("Terminal input data must be a string.", 400);
  requireOk(await postTermJson("/api/v1/term/input", { id: requireSessionId(id), data }, signal, fetcher, bridge));
}

export async function resizeTerminal(
  id: string,
  cols: number,
  rows: number,
  signal?: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  if (!validDim(cols) || !validDim(rows)) throw new ApiError("Terminal dimensions must be integers between 2 and 500.", 400);
  requireOk(await postTermJson("/api/v1/term/resize", { id: requireSessionId(id), cols, rows }, signal, fetcher, bridge));
}

export async function closeTerminal(
  id: string,
  signal?: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
  keepalive = false,
): Promise<void> {
  requireOk(await postTermJson("/api/v1/term/close", { id: requireSessionId(id) }, signal, fetcher, bridge, keepalive));
}

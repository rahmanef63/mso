import type { Process } from "../../../../../lib/contracts/os-api";
import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export type { Process, ShellBridge };
export { ApiError };

export type ProcessesState =
  | { kind: "loading" }
  | { kind: "ready"; processes: Process[] }
  | { kind: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) return "Your session is unavailable or this device no longer has access.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  return `Process inventory request failed (${status}).`;
}

function validateProcesses(value: unknown): Process[] {
  if (!Array.isArray(value)) throw new ApiError("The MSO process inventory response is invalid.", 502);
  const rows: Process[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.pid !== "number" || !Number.isInteger(item.pid) || item.pid <= 0
      || typeof item.name !== "string" || item.name.trim().length === 0
      || typeof item.status !== "string"
      || !isNonNegative(item.cpu) || !isNonNegative(item.mem)
    ) {
      throw new ApiError("The MSO process inventory response is invalid.", 502);
    }
    rows.push({ pid: item.pid, name: item.name, status: item.status, cpu: item.cpu, mem: item.mem });
  }
  return rows;
}

export async function readProcesses(
  signal: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<Process[]> {
  const response = await fetcher(resolveApiUrl("/api/v1/sys/processes", bridge), {
    method: "GET",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError("The MSO process inventory response is invalid.", 502);
  }
  return validateProcesses(parsed);
}

// One owner per mounted list. Refresh/dispose invalidates older requests even if fetch ignores AbortSignal.
export function createProcessesController(
  update: (state: ProcessesState) => void,
  fetcher = fetch,
  bridge?: ShellBridge,
) {
  let generation = 0;
  let active: AbortController | undefined;
  let disposed = false;

  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const processes = await readProcesses(controller.signal, fetcher, bridge);
        if (disposed || run !== generation) return;
        update({ kind: "ready", processes });
      } catch (error) {
        if (disposed || run !== generation || controller.signal.aborted) return;
        update({
          kind: "error",
          message: error instanceof ApiError
            ? error.message
            : "Could not load host processes. Check the backend and retry.",
        });
      }
    },
    dispose() {
      disposed = true;
      generation++;
      active?.abort();
    },
  };
}

import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export type EditorExecResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  error: string | null;
  durationMs: number;
};

export function defaultRunCommand(path: string, language: string): string {
  const safePath = path.trim();
  if (!safePath) return "";
  if (language === "Python") return `python3 ${safePath}`;
  if (language === "Shell") return `sh ${safePath}`;
  if (language === "JavaScript" || language === "JavaScript JSX") return `node ${safePath}`;
  if (language === "TypeScript" || language === "TypeScript JSX") return `bun ${safePath}`;
  if (language === "Go") return `go run ${safePath}`;
  return safePath;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function execStatusMessage(status: number, serverError?: string): string {
  if (status === 401) return "Authentication required to run scripts on this host.";
  if (status === 403) return "Permission denied. Owner role or exec permission is required to run files.";
  if (status === 404) return "Script runner endpoint (/api/v1/editor/exec) is not available on this host.";
  if (status === 429) return "Too many run requests. Wait a moment and retry.";
  return serverError || `Execution request failed with status ${status}.`;
}

export async function runEditorFile(
  params: { path: string; language: string; content: string; command?: string },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<EditorExecResult> {
  const command = (params.command?.trim() || defaultRunCommand(params.path, params.language)).trim();
  const started = Date.now();
  if (!params.path.trim()) {
    return {
      ok: false, exitCode: 1, stdout: "", stderr: "", command,
      error: "Open or save a file before running.", durationMs: 0,
    };
  }
  try {
    const response = await fetcher(resolveApiUrl("/api/v1/editor/exec", bridge), {
      method: "POST",
      credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        path: params.path,
        language: params.language,
        content: params.content,
        cmd: command,
      }),
    });
    const durationMs = Date.now() - started;
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
    let payload: unknown = null;
    if (isJson) {
      try { payload = await response.json(); } catch { payload = null; }
    }
    const serverError = isRecord(payload) && typeof payload.error === "string" ? payload.error : undefined;
    if (!response.ok) {
      const msg = execStatusMessage(response.status, serverError);
      const stderr = isRecord(payload) && typeof payload.stderr === "string" ? payload.stderr : msg;
      return { ok: false, exitCode: response.status, stdout: "", stderr, command, error: msg, durationMs };
    }
    if (!isRecord(payload)) {
      return {
        ok: false, exitCode: 1, stdout: "", stderr: "", command, durationMs,
        error: "Script runner returned an unexpected response format.",
      };
    }
    const stdout = typeof payload.stdout === "string"
      ? payload.stdout
      : typeof payload.output === "string"
        ? payload.output
        : Array.isArray(payload.results)
          ? JSON.stringify(payload.results, null, 2)
          : "";
    const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
    const rawCode = typeof payload.exitCode === "number"
      ? payload.exitCode
      : typeof payload.code === "number"
        ? payload.code
        : serverError ? 1 : 0;
    return {
      ok: rawCode === 0 && !serverError,
      exitCode: rawCode,
      stdout,
      stderr,
      command,
      error: serverError ?? null,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    if (signal.aborted) {
      return { ok: false, exitCode: null, stdout: "", stderr: "", command, error: "Run cancelled.", durationMs };
    }
    const message = err instanceof Error ? err.message : "Could not reach /api/v1/editor/exec.";
    return { ok: false, exitCode: 1, stdout: "", stderr: message, command, error: message, durationMs };
  }
}

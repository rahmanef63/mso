import os from "node:os";
import path from "node:path";

const MAX_CWD_BYTES = 4 * 1024;

export function normalizeAgentSessionCwd(value?: string): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/[\r\n\0]/.test(raw)) throw new Error("invalid agent session cwd");
  if (Buffer.byteLength(raw, "utf8") > MAX_CWD_BYTES)
    throw new Error("agent session cwd is too long");
  const expanded =
    raw === "~"
      ? os.homedir()
      : raw.startsWith("~/")
        ? path.join(os.homedir(), raw.slice(2))
        : raw;
  if (!path.isAbsolute(expanded))
    throw new Error("agent session cwd must be absolute");
  return path.resolve(expanded);
}

export function sessionCwdRefMatch(
  cwd: string | undefined,
  ref: string,
): boolean {
  if (!cwd) return false;
  const query = String(ref || "").trim();
  if (!query) return false;
  try {
    if (query.startsWith("/") || query === "~" || query.startsWith("~/"))
      return normalizeAgentSessionCwd(query) === path.resolve(cwd);
  } catch {
    return false;
  }
  const normalized = path.resolve(cwd);
  return path.basename(normalized).toLowerCase() === query.toLowerCase();
}

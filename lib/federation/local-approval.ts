import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { resolveProjectHint } from "@/lib/host/projects-api";
import { FEDERATION_WORKER_ID, validateFederationArguments } from "./security";

type Request = { id: string; projectId: string; source: string; operation: string; scope: string; arguments?: Record<string, unknown> };
type Approval = { principal: string; requestDigest: string; expiresAt: number; usedAt?: number };
const approvalFile = () => path.join(os.homedir(), ".mso", "private", "federation-approvals.json");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
/** Owner reviews the entire request, including exact project, operation, scope and arguments. */
export function federationRequestDigest(request: Request): string {
  return createHash("sha256").update(JSON.stringify(canonical({ id: request.id, projectId: request.projectId, source: request.source, operation: request.operation, scope: request.scope, arguments: validateFederationArguments(request.arguments ?? {}) }))).digest("hex");
}
export async function consumeFederationApproval(request: Request): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.id)) throw new Error("invalid federation request identity");
  const project = await resolveProjectHint(request.projectId);
  if (!project || project.matchedBy === "fuzzy") throw new Error("federation requires an exact local project");
  const file = approvalFile();
  return withSecurityStoreLock(file, async () => {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat();
      if (!before.isFile() || before.size > 512 * 1024 || before.mode & 0o077 || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("unsafe federation approval store");
      const bytes = Buffer.alloc(before.size + 1); let used = 0;
      while (used < bytes.length) { const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used); if (!bytesRead) break; used += bytesRead; }
      const after = await handle.stat();
      if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("federation approval store changed");
      const approvals = JSON.parse(bytes.subarray(0, used).toString("utf8")) as Record<string, Approval>;
      const approval = Object.hasOwn(approvals, request.id) ? approvals[request.id] : undefined;
      if (!approval || approval.principal !== FEDERATION_WORKER_ID || approval.requestDigest !== federationRequestDigest(request) || !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= Date.now() || approval.expiresAt > Date.now() + 86400000 || approval.usedAt) throw new Error("federation local approval missing, expired, revoked, changed or already used");
      approval.usedAt = Date.now();
      const temp = file + "." + process.pid + ".tmp";
      try { await fs.writeFile(temp, JSON.stringify(approvals), { flag: "wx", mode: 0o600 }); await fs.rename(temp, file); }
      finally { await fs.unlink(temp).catch(() => undefined); }
      return project.path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("federation requires local Owner approval");
      throw error;
    } finally { await handle?.close(); }
  });
}

import {
  createAgentSession,
  getAgentSession,
  listAgentSessionsOwner,
} from "./session-store";
import { listSessionRecords, principalHash } from "./session-files";
import { redactText } from "@/lib/security/redact-text";
import type { AgentSession } from "./session-types";
import {
  normalizeAgentSessionCwd,
  sessionCwdRefMatch,
} from "./session-location";

function cleanRef(value: string): string {
  return value.trim().replace(/^-(?=\d{8}_\d{6}_[a-f0-9]{8}$)/, "");
}

export function chooseAgentSessionRecord(
  records: AgentSession[],
  refValue: string,
): AgentSession {
  const resumable = records
    .filter((row) => {
      const emptyDefaultCli =
        row.source === "cli" &&
        row.history.length === 0 &&
        row.title === "MSO Agent session" &&
        (row.titleSource === "default" || row.titleSource === "manual");
      return !emptyDefaultCli;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!resumable.length) throw new Error("session_not_found");

  const ref = cleanRef(refValue),
    q = ref.toLowerCase();
  if (!ref || q === "latest" || q === "continue") return resumable[0]!;
  const exactId = resumable.find((row) => row.id === ref);
  if (exactId) return exactId;
  if (/^[1-9]\d{0,3}$/.test(ref)) {
    const indexed = resumable[Number(ref) - 1];
    if (indexed) return indexed;
    throw new Error("session_not_found");
  }

  const idMatches = resumable.filter(
    (row) =>
      row.id.toLowerCase().startsWith(q) || row.id.toLowerCase().endsWith(q),
  );
  if (idMatches.length === 1) return idMatches[0]!;

  const cwdMatches = resumable.filter((row) =>
    sessionCwdRefMatch(row.cwd, ref),
  );
  if (cwdMatches.length === 1) return cwdMatches[0]!;
  if (cwdMatches.length > 1) {
    const labels = cwdMatches
      .slice(0, 6)
      .map((row) => `${row.title} @ ${row.cwd || "?"}`);
    throw new Error(`session location is ambiguous: ${labels.join(" | ")}`);
  }

  const exactTitle = resumable.filter((row) => row.title.toLowerCase() === q);
  if (exactTitle.length === 1) return exactTitle[0]!;
  const titlePrefix = resumable.filter((row) =>
    row.title.toLowerCase().startsWith(q),
  );
  if (titlePrefix.length === 1) return titlePrefix[0]!;
  const fuzzyTitle = resumable.filter((row) =>
    row.title.toLowerCase().includes(q),
  );
  if (fuzzyTitle.length === 1) return fuzzyTitle[0]!;

  const matches = [...idMatches, ...exactTitle, ...titlePrefix, ...fuzzyTitle];
  const unique = [...new Map(matches.map((row) => [row.id, row])).values()];
  if (unique.length > 1) {
    const labels = unique
      .slice(0, 6)
      .map((row) => row.title.replace(/[\r\n\t]+/g, " ").slice(0, 72));
    throw new Error(`session reference is ambiguous: ${labels.join(" | ")}`);
  }
  throw new Error("session_not_found");
}

export async function resolveAgentSessionRef(
  principal: string,
  ref: string,
): Promise<AgentSession> {
  const owner = principalHash(principal);
  return chooseAgentSessionRecord(
    (await listSessionRecords()).filter((row) => row.principalHash === owner),
    ref,
  );
}

export async function resolveAgentSessionOwnerRef(
  ref: string,
): Promise<AgentSession> {
  return chooseAgentSessionRecord(await listSessionRecords(), ref);
}

function resumedSummary(target: AgentSession): string {
  const events = target.events
    .slice(-20)
    .map(
      (row) =>
        `${row.at} ${row.tool || row.kind}${row.state ? `:${row.state}` : ""}${row.detail ? ` — ${redactText(row.detail, 260)}` : ""}`,
    );
  return [
    target.contextSummary || "",
    `Resumed in CLI from ${target.id} (${target.source}) at ${new Date().toISOString()}.`,
    events.length
      ? `Recent source events:\n${events.map((v) => `- ${v}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 32_000);
}

export async function resumeAgentSessionForOwner(
  cliPrincipal: string,
  ref: string,
  cwd?: string,
): Promise<AgentSession> {
  const target = await resolveAgentSessionOwnerRef(ref);
  const existing = await getAgentSession(cliPrincipal, target.id).catch(
    () => null,
  );
  if (existing?.source === "cli") return existing;
  return createAgentSession(cliPrincipal, "cli", {
    title: `Resume · ${target.title}`,
    titleSource: "auto",
    resumedFrom: target.id,
    cwd: normalizeAgentSessionCwd(cwd) || target.cwd,
    memorySnapshot: target.memorySnapshot,
    contextSummary: resumedSummary(target),
    history: target.history.slice(-24),
  });
}

export async function ownerSessionSummaries(limit = 100) {
  return listAgentSessionsOwner(limit);
}

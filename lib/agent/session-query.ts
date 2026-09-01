import { createAgentSession, getAgentSession, listAgentSessionsOwner } from "./session-store";
import { listSessionRecords, principalHash } from "./session-files";
import { redactText } from "@/lib/security/redact-text";
import type { AgentSession } from "./session-types";

function cleanRef(value: string): string {
  return value.trim().replace(/^-(?=\d{8}_\d{6}_[a-f0-9]{8}$)/, "");
}

function choose(records: AgentSession[], refValue: string): AgentSession {
  const ref = cleanRef(refValue), q = ref.toLowerCase();
  const exactId = records.find((row) => row.id === ref); if (exactId) return exactId;
  const idPrefix = records.filter((row) => row.id.startsWith(ref)); if (idPrefix.length === 1) return idPrefix[0]!;
  const exactTitle = records.filter((row) => row.title.toLowerCase() === q); if (exactTitle.length === 1) return exactTitle[0]!;
  const titlePrefix = records.filter((row) => row.title.toLowerCase().startsWith(q)); if (titlePrefix.length === 1) return titlePrefix[0]!;
  const matches = [...idPrefix, ...exactTitle, ...titlePrefix];
  if (matches.length > 1) throw new Error(`session reference is ambiguous: ${[...new Set(matches.map((row) => row.id))].slice(0, 6).join(", ")}`);
  throw new Error("session_not_found");
}

export async function resolveAgentSessionRef(principal: string, ref: string): Promise<AgentSession> {
  const owner = principalHash(principal);
  return choose((await listSessionRecords()).filter((row) => row.principalHash === owner), ref);
}

export async function resolveAgentSessionOwnerRef(ref: string): Promise<AgentSession> {
  return choose(await listSessionRecords(), ref);
}

function resumedSummary(target: AgentSession): string {
  const events = target.events.slice(-20).map((row) =>
    `${row.at} ${row.tool || row.kind}${row.state ? `:${row.state}` : ""}${row.detail ? ` — ${redactText(row.detail, 260)}` : ""}`,
  );
  return [target.contextSummary || "", `Resumed in CLI from ${target.id} (${target.source}) at ${new Date().toISOString()}.`, events.length ? `Recent source events:\n${events.map((v) => `- ${v}`).join("\n")}` : ""]
    .filter(Boolean).join("\n\n").slice(0, 32_000);
}

export async function resumeAgentSessionForOwner(cliPrincipal: string, ref: string): Promise<AgentSession> {
  const target = await resolveAgentSessionOwnerRef(ref);
  const existing = await getAgentSession(cliPrincipal, target.id).catch(() => null);
  if (existing?.source === "cli") return existing;
  return createAgentSession(cliPrincipal, "cli", {
    title: `Resume · ${target.title}`, titleSource: "auto", resumedFrom: target.id,
    memorySnapshot: target.memorySnapshot, contextSummary: resumedSummary(target), history: target.history.slice(-24),
  });
}

export async function ownerSessionSummaries(limit = 100) { return listAgentSessionsOwner(limit); }

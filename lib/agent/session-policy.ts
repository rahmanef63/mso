import { createHash } from "node:crypto";
import { redactText } from "@/lib/security/redact-text";
import type { AgentSession, AgentSessionEvent, AgentSessionTitleSource } from "./session-types";

export const MAX_HISTORY = 4096;
export const MAX_EVENTS = 400;
const DEFAULT_COMPACT_TOKENS = 700_000;
const DEFAULT_RECENT_TOKENS = 140_000;
const GENERIC_TITLES = /^(MSO Agent session|ChatGPT\/MCP|ChatGPT session|MCP legacy session)/i;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}

export function compactThresholdTokens(): number {
  return intEnv("OS_AGENT_SESSION_COMPACT_TOKENS", DEFAULT_COMPACT_TOKENS, 10_000, 5_000_000);
}

export function recentContextTargetTokens(): number {
  return Math.min(compactThresholdTokens() - 1_000, intEnv("OS_AGENT_SESSION_RECENT_TOKENS", DEFAULT_RECENT_TOKENS, 5_000, 500_000));
}

export function estimateTokens(value: unknown): number {
  let text: string;
  try { text = typeof value === "string" ? value : JSON.stringify(value ?? ""); }
  catch { text = String(value ?? ""); }
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

export function safeTitle(value: string | undefined): string {
  const text = String(value ?? "MSO Agent session").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return (text || "MSO Agent session").slice(0, 120);
}

export function autoSessionTitle(hint: string): string {
  const clean = redactText(String(hint).replace(/[`*_#>]+/g, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim(), 500);
  const clause = clean.split(/\s+[—–|]\s+|[.!?](?:\s|$)/)[0]?.trim() || clean;
  return safeTitle(clause.slice(0, 88) || "MSO Agent session");
}

export function inferredTitleSource(title: string, source?: AgentSessionTitleSource): AgentSessionTitleSource {
  if (source) return source;
  return GENERIC_TITLES.test(title) ? "default" : "auto";
}

export function conversationHash(principal: string, raw: string): string {
  return createHash("sha256").update(principal).update("\0").update(raw).digest("hex");
}

export function sessionContextTokens(record: Pick<AgentSession, "memorySnapshot" | "contextSummary" | "history" | "events">): number {
  return estimateTokens(record.memorySnapshot) + estimateTokens(record.contextSummary ?? "") + estimateTokens(record.history) + estimateTokens(record.events);
}

function lineFromHistory(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const role = typeof item.role === "string" ? item.role : "context";
  const text = typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : "";
  if (!text.trim()) return null;
  return `${role}: ${redactText(text.replace(/\s+/g, " ").trim(), 700)}`;
}

function summaryFrom(record: AgentSession, at: string): string {
  const prior = record.contextSummary ? redactText(record.contextSummary, 12_000) : "";
  const turns = record.history.map(lineFromHistory).filter((v): v is string => Boolean(v)).slice(-28);
  const events = record.events.slice(-24).map((e: AgentSessionEvent) =>
    `${e.at} ${e.tool || e.kind}${e.state ? `:${e.state}` : ""}${e.detail ? ` — ${redactText(e.detail, 360)}` : ""}`,
  );
  return [
    `MSO session context compacted at ${at}.`,
    prior ? `Previous compact summary:\n${prior}` : "",
    turns.length ? `Key recent conversation turns:\n${turns.map((v) => `- ${v}`).join("\n")}` : "",
    events.length ? `Recent operational timeline:\n${events.map((v) => `- ${v}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 32_000);
}

function compactRow(row: unknown): unknown {
  if (typeof row === "string") return row.length > 24_000 ? row.slice(0, 24_000) + "\n[compacted]" : row;
  if (!row || typeof row !== "object") return row;
  const copy = structuredClone(row) as Record<string, unknown>;
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === "string" && value.length > 24_000) copy[key] = value.slice(0, 24_000) + "\n[compacted]";
    else if (Array.isArray(value) && value.length > 40) copy[key] = value.slice(-40);
  }
  return copy;
}

export function compactSessionContext(record: AgentSession, at: string): AgentSession {
  const target = recentContextTargetTokens();
  const kept: unknown[] = [];
  let used = 0;
  for (const raw of [...record.history].reverse()) {
    const row = compactRow(raw);
    const cost = estimateTokens(row);
    if (kept.length && used + cost > target) break;
    kept.unshift(row); used += cost;
    if (used >= target) break;
  }
  const event: AgentSessionEvent = { at, kind: "compacted", detail: `context exceeded ${record.compactThresholdTokens} estimated tokens` };
  const next: AgentSession = {
    ...record,
    contextSummary: summaryFrom(record, at),
    history: kept.slice(-MAX_HISTORY),
    events: [...record.events.slice(-(MAX_EVENTS - 1)), event],
    compactionCount: record.compactionCount + 1,
    lastCompactedAt: at,
    updatedAt: at,
  };
  return { ...next, estimatedTokens: sessionContextTokens(next) };
}

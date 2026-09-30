"use client";

import { useSyncExternalStore } from "react";

type Grant = { key: string; tool: string; scope: string };
let grants: Grant[] = [];
let conversation = 1;
const subscribers = new Set<() => void>();
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => subscribers.delete(fn); };
const emit = () => subscribers.forEach((fn) => fn());
const getGrants = () => grants;
const EMPTY: Grant[] = [];
export function useAlfaApprovalGrants() { return useSyncExternalStore(subscribe, getGrants, () => EMPTY); }

export function alfaApprovalScope(project: string | undefined, mode: string): string {
  return `Conversation ${conversation} · ${project || "no project"} · ${mode}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export function alfaApprovalKey(tool: string, input: Record<string, unknown>, scope: string): string {
  return canonical([scope, tool, input]);
}

/** Only exact reviewed file calls can be remembered. Host jail/auth remain mandatory. */
export function canRememberAlfaTool(tool: string, input: Record<string, unknown>): boolean {
  if (!["fs.write", "fs.mkdir", "fs.copy"].includes(tool)) return false;
  if (canonical(input).length > 32_768) return false;
  const paths = tool === "fs.copy" ? [input.from, input.to] : [input.path];
  return paths.every((path) => typeof path === "string" && path.length > 0
    && !/(^|[/\\])(?:\.\.?|\.env[^/\\]*|\.ssh|\.gnupg|\.mso|\.aws|\.config|etc|proc|sys|dev|boot)([/\\]|$)/i.test(path)
    && !/(credential|secret|token|password|keychain|\.pem$|\.key$)/i.test(path));
}

export function rememberAlfaApproval(tool: string, input: Record<string, unknown>, scope: string): void {
  if (!canRememberAlfaTool(tool, input)) return;
  const key = alfaApprovalKey(tool, input, scope);
  if (grants.some((grant) => grant.key === key)) return;
  grants = [...grants, { key, tool, scope }].slice(-64);
  emit();
}
export function hasAlfaApproval(tool: string, input: Record<string, unknown>, scope: string): boolean {
  return canRememberAlfaTool(tool, input) && grants.some((grant) => grant.key === alfaApprovalKey(tool, input, scope));
}
export function revokeAlfaApproval(key: string): void {
  grants = grants.filter((grant) => grant.key !== key); emit();
}
export function resetAlfaApprovalPolicy(): void { grants = []; emit(); }
export function newAlfaApprovalSession(): void { conversation++; resetAlfaApprovalPolicy(); }

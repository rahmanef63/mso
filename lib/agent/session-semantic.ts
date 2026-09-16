import type { SessionFlowCategory } from "@/lib/contracts/session-monitor";
import type { AgentSessionEvent, AgentSessionEventSemantic } from "./session-types";

const CATEGORIES = new Set<SessionFlowCategory>([
  "context", "plan", "inspect", "implement", "verify", "integrate", "deploy", "result", "other",
]);

export function classifySessionEvent(event: Pick<AgentSessionEvent, "kind" | "tool" | "detail">): SessionFlowCategory {
  const tool = (event.tool || "").toLowerCase();
  const detail = (event.detail || "").toLowerCase();
  const hay = `${tool} ${detail}`;
  if (["created", "resumed", "compacted"].includes(event.kind)) return "context";
  if (event.kind === "archived" || /workflow_(finish|cancel)/.test(tool)) return "result";
  if (/workflow_start/.test(tool) || (/\b(plan|intent|scope|approach)\b/.test(detail) && event.kind === "note")) return "plan";
  if (/\b(deploy|dokploy|systemctl|restart|health(?:check)?|production|cloudflare)\b/.test(hay)) return "deploy";
  if (/\bgit\s+(add|commit|merge|cherry-pick|push|rebase|reset|tag)\b/.test(detail) || /\b(pull request|\bpr\b)\b/.test(hay)) return "integrate";
  if (/\b(test|vitest|playwright|lint|typecheck|coverage|audit|verify|verification|check|build)\b/.test(hay)) return "verify";
  if (/\b(fs_write|fs_delete|fs_move|fs_copy|apply_patch|patch|edit|update|create|save|write)\b/.test(tool) || /\b(sed\s+-i|perl\s+-pi|mkdir|rm\s+-|cp\s+|mv\s+|cat\s+>|tee\s+)\b/.test(detail)) return "implement";
  if (/\b(fs_read|fs_list|fs_search|read|search|list|query|inspect|status|find)\b/.test(tool) || /^(git\s+(status|diff|log|show)|rg\b|grep\b|find\b|ls\b|cat\b|sed\s+-n)/.test(detail)) return "inspect";
  if (event.kind === "note") return "context";
  if (event.kind === "workflow") return "plan";
  return "other";
}

function validSemantic(value: AgentSessionEvent["semantic"]): value is AgentSessionEventSemantic {
  return Boolean(value && value.version === 1 && Number.isSafeInteger(value.step) && value.step > 0 && Number.isSafeInteger(value.action) && value.action > 0 && CATEGORIES.has(value.category));
}

function nextSemantic(last: AgentSessionEventSemantic | undefined, category: SessionFlowCategory): AgentSessionEventSemantic {
  if (last?.category === category) return { version: 1, step: last.step, action: last.action + 1, category };
  return { version: 1, step: (last?.step || 0) + 1, action: 1, category };
}

/** Backfill only missing legacy metadata. Persisted semantic refs remain authoritative even if classifiers evolve. */
export function normalizeSessionEventSemantics(events: AgentSessionEvent[]): AgentSessionEvent[] {
  let last: AgentSessionEventSemantic | undefined;
  return events.map((event) => {
    if (validSemantic(event.semantic)) {
      last = event.semantic;
      return event;
    }
    const semantic = nextSemantic(last, classifySessionEvent(event));
    last = semantic;
    return { ...event, semantic };
  });
}

export function appendSemanticSessionEvent(events: AgentSessionEvent[], event: AgentSessionEvent): AgentSessionEvent[] {
  const normalized = normalizeSessionEventSemantics(events);
  const last = normalized.at(-1)?.semantic;
  const semantic = nextSemantic(validSemantic(last) ? last : undefined, classifySessionEvent(event));
  return [...normalized, { ...event, semantic }];
}

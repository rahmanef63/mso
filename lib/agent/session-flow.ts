import path from "node:path";
import { SESSION_GRAPH_EVENT_LIMIT, type SessionFlowAction, type SessionFlowCategory, type SessionFlowStep } from "@/lib/contracts/session-monitor";
import { redactText } from "@/lib/security/redact-text";
import type { AgentSessionEvent } from "./session-types";

const STEP_LIMIT = 8;
const CODE_EXTENSIONS = new Set(["ts","tsx","js","jsx","mjs","cjs","svelte","py","sh","bash","zsh","md","json","yaml","yml","css","scss","html","sql","toml"]);
const TITLES: Record<SessionFlowCategory, string> = {
  context: "Context", plan: "Plan", inspect: "Inspect", implement: "Implement",
  verify: "Verify", integrate: "Integrate", deploy: "Deploy", result: "Result", other: "Actions",
};

function text(value: string | undefined, max = 1000): string | undefined {
  return value ? redactText(value, max).replace(/[\u0000-\u001f\u007f]/g, " ").trim() || undefined : undefined;
}
function safeEvent(row: AgentSessionEvent) {
  return { at: row.at, kind: text(row.kind, 40) || "note", tool: text(row.tool, 100), state: text(row.state, 60), detail: text(row.detail, 1000) };
}
function classify(event: ReturnType<typeof safeEvent>): SessionFlowCategory {
  const tool = (event.tool || "").toLowerCase(), detail = (event.detail || "").toLowerCase(), hay = `${tool} ${detail}`;
  if (["created", "resumed", "compacted"].includes(event.kind)) return "context";
  if (event.kind === "archived" || /workflow_(finish|cancel)/.test(tool)) return "result";
  if (/workflow_start/.test(tool) || /\b(plan|intent|scope|approach)\b/.test(detail) && event.kind === "note") return "plan";
  if (/\b(deploy|dokploy|systemctl|restart|health(?:check)?|production|cloudflare)\b/.test(hay)) return "deploy";
  if (/\bgit\s+(add|commit|merge|cherry-pick|push|rebase|reset|tag)\b/.test(detail) || /\b(pull request|\bpr\b)\b/.test(hay)) return "integrate";
  if (/\b(test|vitest|playwright|lint|typecheck|coverage|audit|verify|verification|check|build)\b/.test(hay)) return "verify";
  if (/\b(fs_write|fs_delete|fs_move|fs_copy|apply_patch|patch|edit|update|create|save|write)\b/.test(tool) || /\b(sed\s+-i|perl\s+-pi|mkdir|rm\s+-|cp\s+|mv\s+|cat\s+>|tee\s+)\b/.test(detail)) return "implement";
  if (/\b(fs_read|fs_list|fs_search|read|search|list|query|inspect|status|find)\b/.test(tool) || /^(git\s+(status|diff|log|show)|rg\b|grep\b|find\b|ls\b|cat\b|sed\s+-n)/.test(detail)) return "inspect";
  if (event.kind === "note") return "context";
  if (event.kind === "workflow") return "plan";
  return "other";
}
function humanize(value: string): string {
  return value.replace(/[_.:-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}
function actionTitle(event: ReturnType<typeof safeEvent>): string {
  const detail = event.detail?.split("\n")[0]?.trim();
  if (event.tool && /^(exec(?:_|\.)|terminal|shell)/i.test(event.tool) && detail) return `Run · ${detail}`.slice(0, 110);
  if (event.tool && /^fs_(read|write|delete|move|copy)/i.test(event.tool) && detail) return `${humanize(event.tool)} · ${detail}`.slice(0, 110);
  return humanize(event.tool || event.kind || "Action").slice(0, 110);
}
function languageFor(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return ({ ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",cjs:"javascript",svelte:"svelte",py:"python",sh:"bash",bash:"bash",zsh:"zsh",md:"markdown",json:"json",yaml:"yaml",yml:"yaml",css:"css",scss:"scss",html:"html",sql:"sql",toml:"toml" } as Record<string,string>)[ext] || "text";
}
function artifactPath(detail: string | undefined, cwd: string | undefined): SessionFlowAction["artifact"] | undefined {
  if (!detail || !cwd) return undefined;
  const candidates = detail.match(/(?:\.?\.?\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.[A-Za-z0-9]+/g) || [];
  for (const raw of candidates) {
    const ext = raw.split(".").pop()?.toLowerCase() || "";
    if (!CODE_EXTENSIONS.has(ext) || raw.includes("..")) continue;
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw.replace(/^\.\//, ""));
    const rel = path.relative(path.resolve(cwd), resolved);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    return { path: resolved, label: path.basename(resolved), kind: ["sh","bash","zsh","py","js","ts"].includes(ext) ? "script" : "file", language: languageFor(resolved) };
  }
  return undefined;
}
function actionCode(event: ReturnType<typeof safeEvent>, artifact: SessionFlowAction["artifact"]): SessionFlowAction["code"] | undefined {
  if (!event.detail) return undefined;
  if (event.tool && /^(exec(?:_|\.)|terminal|shell|project_script_run)/i.test(event.tool)) return { kind: /script/i.test(event.tool) ? "script" : "command", language: "bash", content: event.detail };
  if (artifact && event.detail.includes("\n")) return { kind: artifact.kind === "script" ? "script" : "snippet", language: artifact.language || "text", content: event.detail };
  return undefined;
}
function dominantCategory(actions: SessionFlowAction[]): SessionFlowCategory {
  const counts = new Map<SessionFlowCategory, number>();
  for (const action of actions) counts.set(action.category, (counts.get(action.category) || 0) + 1);
  return [...counts.entries()].sort((a,b) => b[1] - a[1])[0]?.[0] || "other";
}
function summarize(actions: SessionFlowAction[]): string {
  const tools = [...new Set(actions.map((action) => action.tool).filter((tool): tool is string => Boolean(tool)))].slice(0, 3).map(humanize);
  return `${actions.length} action${actions.length === 1 ? "" : "s"}${tools.length ? ` · ${tools.join(" · ")}` : ""}`;
}

export function semanticSessionFlow(events: AgentSessionEvent[], requestedLimit = SESSION_GRAPH_EVENT_LIMIT, cwd?: string) {
  const limit = Math.max(1, Math.min(SESSION_GRAPH_EVENT_LIMIT, Math.trunc(requestedLimit) || SESSION_GRAPH_EVENT_LIMIT));
  const totalEvents = events.length, omittedEvents = Math.max(0, totalEvents - limit);
  const actions = events.slice(-limit).map(safeEvent).map((event, index): SessionFlowAction => {
    const artifact = artifactPath(event.detail, cwd), category = classify(event);
    return { ref: "", eventRef: `E${omittedEvents + index + 1}`, title: actionTitle(event), category, at: event.at, kind: event.kind,
      ...(event.tool ? { tool: event.tool } : {}), ...(event.state ? { state: event.state } : {}), ...(event.detail ? { detail: event.detail } : {}),
      terminalContext: Boolean(event.tool && /^(exec(?:_|\.)|terminal|shell)/i.test(event.tool)), ...(artifact ? { artifact } : {}),
      ...(actionCode(event, artifact) ? { code: actionCode(event, artifact) } : {}),
    };
  });
  let groups: SessionFlowAction[][] = [];
  for (const action of actions) {
    const last = groups.at(-1);
    if (last && last.at(-1)?.category === action.category) last.push(action); else groups.push([action]);
  }
  while (groups.length > STEP_LIMIT) {
    let smallest = 0;
    for (let i = 1; i < groups.length; i += 1) if (groups[i]!.length < groups[smallest]!.length) smallest = i;
    const target = smallest === 0 ? 1 : smallest === groups.length - 1 ? smallest - 1 : groups[smallest - 1]!.length <= groups[smallest + 1]!.length ? smallest - 1 : smallest + 1;
    const start = Math.min(smallest, target), merged = [...groups[start]!, ...groups[start + 1]!];
    groups.splice(start, 2, merged);
  }
  const steps: SessionFlowStep[] = groups.map((group, stepIndex) => {
    const ref = `S${stepIndex + 1}`, category = dominantCategory(group);
    const categories = [...new Set(group.map((action) => action.category))];
    group.forEach((action, actionIndex) => { action.ref = `${ref}.A${actionIndex + 1}`; });
    return { ref, title: categories.length === 1 ? TITLES[category] : categories.slice(0, 2).map((item) => TITLES[item]).join(" & "), category,
      summary: summarize(group), startedAt: group[0]!.at, finishedAt: group.at(-1)!.at, actions: group };
  });
  return { totalEvents, shownEvents: actions.length, omittedEvents, steps };
}

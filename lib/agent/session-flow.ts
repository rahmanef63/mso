import { createHash } from "node:crypto";
import path from "node:path";
import {
  SESSION_GRAPH_EVENT_LIMIT,
  type SessionFlowAction,
  type SessionFlowActionGroup,
  type SessionFlowActionResolution,
  type SessionFlowCategory,
  type SessionFlowStep,
} from "@/lib/contracts/session-monitor";
import { redactText } from "@/lib/security/redact-text";
import { eventSequenceBase } from "./session-sequence";
import { normalizeSessionEventSemantics } from "./session-semantic";
import type { AgentSessionEvent } from "./session-types";

const STEP_LIMIT = 8;
const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "svelte", "py", "sh", "bash", "zsh", "md", "json", "yaml", "yml", "css", "scss", "html", "sql", "toml"]);
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
  return ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", svelte: "svelte", py: "python", sh: "bash", bash: "bash", zsh: "zsh", md: "markdown", json: "json", yaml: "yaml", yml: "yaml", css: "css", scss: "scss", html: "html", sql: "sql", toml: "toml" } as Record<string, string>)[ext] || "text";
}
function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function artifactPath(detail: string | undefined, cwd: string | undefined, revisionRef: string): SessionFlowAction["artifact"] | undefined {
  if (!detail || !cwd) return undefined;
  const candidates = detail.match(/(?:\/|\.?\.?\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.[A-Za-z0-9]+/g) || [];
  for (const raw of candidates) {
    const ext = raw.split(".").pop()?.toLowerCase() || "";
    if (!CODE_EXTENSIONS.has(ext) || raw.includes("..")) continue;
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw.replace(/^\.\//, ""));
    const rel = path.relative(path.resolve(cwd), resolved);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    return {
      ref: stableId("artifact", rel.replaceAll(path.sep, "/")),
      revisionRef,
      path: resolved,
      relativePath: rel.replaceAll(path.sep, "/"),
      label: path.basename(resolved),
      kind: ["sh", "bash", "zsh", "py", "js", "ts"].includes(ext) ? "script" : "file",
      language: languageFor(resolved),
    };
  }
  return undefined;
}
function actionCode(event: ReturnType<typeof safeEvent>, artifact: SessionFlowAction["artifact"]): SessionFlowAction["code"] | undefined {
  if (!event.detail) return undefined;
  if (event.tool && /^(exec(?:_|\.)|terminal|shell|project_script_run)/i.test(event.tool)) return { kind: /script/i.test(event.tool) ? "script" : "command", language: "bash", content: event.detail };
  if (artifact && event.detail.includes("\n")) return { kind: artifact.kind === "script" ? "script" : "snippet", language: artifact.language || "text", content: event.detail };
  return undefined;
}
function actionGroupDescriptor(action: SessionFlowAction): { key: string; title: string } {
  const tool = (action.tool || "").toLowerCase();
  const detail = (action.detail || "").toLowerCase();
  if (/fs_read|\bcat\b|sed\s+-n/.test(`${tool} ${detail}`)) return { key: "read", title: "Read files" };
  if (/fs_search|\brg\b|\bgrep\b|\bfind\b|search/.test(`${tool} ${detail}`)) return { key: "search", title: "Search" };
  if (/git\s+(status|diff|log|show)|\bstatus\b/.test(detail)) return { key: "status", title: "Status & diff" };
  if (/vitest|playwright|\btest\b/.test(`${tool} ${detail}`)) return { key: "tests", title: "Run tests" };
  if (/typecheck|lint|coverage|audit/.test(`${tool} ${detail}`)) return { key: "static", title: "Static checks" };
  if (/\bbuild\b/.test(`${tool} ${detail}`)) return { key: "build", title: "Build" };
  if (/fs_write|fs_delete|fs_move|fs_copy|apply_patch|\bpatch\b|\bedit\b/.test(`${tool} ${detail}`)) return { key: "changes", title: "File changes" };
  if (/git\s+(add|commit|merge|cherry-pick|push|rebase|reset|tag)/.test(detail)) return { key: "git", title: "Git integration" };
  if (/health(?:check)?/.test(`${tool} ${detail}`)) return { key: "health", title: "Health checks" };
  if (/deploy|dokploy|systemctl|restart|production|cloudflare/.test(`${tool} ${detail}`)) return { key: "deploy", title: "Deployment" };
  return { key: action.category, title: TITLES[action.category] };
}
function actionGroups(actions: SessionFlowAction[], stepRef: string): SessionFlowActionGroup[] {
  const groups = new Map<string, SessionFlowActionGroup>();
  for (const action of actions) {
    const descriptor = actionGroupDescriptor(action);
    let group = groups.get(descriptor.key);
    if (!group) {
      group = { ref: `${stepRef}.G${stableId("g", descriptor.key).slice(-6).toUpperCase()}`, key: descriptor.key, title: descriptor.title, actionRefs: [], count: 0 };
      groups.set(descriptor.key, group);
    }
    group.actionRefs.push(action.ref);
    group.count += 1;
  }
  return [...groups.values()];
}
function summarize(actions: SessionFlowAction[], groups: SessionFlowActionGroup[]): string {
  const labels = groups.slice(0, 3).map((group) => group.count > 1 ? `${group.title} ×${group.count}` : group.title);
  return `${actions.length} action${actions.length === 1 ? "" : "s"}${labels.length ? ` · ${labels.join(" · ")}` : ""}`;
}
function semanticTitle(category: SessionFlowCategory, groups: SessionFlowActionGroup[]): string {
  if (!groups.length) return TITLES[category];
  const informative = groups.filter((group) => group.key !== category).slice(0, 2).map((group) => group.title);
  return informative.length ? `${TITLES[category]} · ${informative.join(" + ")}` : TITLES[category];
}

export function sessionFlowActions(events: AgentSessionEvent[], cwd?: string, rawBase = 0): SessionFlowAction[] {
  const normalized = normalizeSessionEventSemantics(events);
  const base = eventSequenceBase(rawBase);
  return normalized.map((row, index) => {
    const event = safeEvent(row);
    const semantic = row.semantic!;
    const ref = `S${semantic.step}.A${semantic.action}`;
    const eventRef = `E${base + index + 1}`;
    const artifact = artifactPath(event.detail, cwd, ref);
    const action: SessionFlowAction = {
      id: stableId("action", `${eventRef}\0${ref}\0${event.at}\0${event.kind}\0${event.tool || ""}`),
      ref,
      eventRef,
      title: actionTitle(event),
      category: semantic.category,
      at: event.at,
      kind: event.kind,
      ...(event.tool ? { tool: event.tool } : {}),
      ...(event.state ? { state: event.state } : {}),
      ...(event.detail ? { detail: event.detail } : {}),
      terminalContext: Boolean(event.tool && /^(exec(?:_|\.)|terminal|shell)/i.test(event.tool)),
      ...(artifact ? { artifact } : {}),
    };
    const code = actionCode(event, artifact);
    return code ? { ...action, code } : action;
  });
}
function stepFromActions(actions: SessionFlowAction[]): SessionFlowStep {
  const first = actions[0]!;
  const ref = first.ref.split(".A", 1)[0]!;
  const groups = actionGroups(actions, ref);
  return {
    id: stableId("step", ref),
    ref,
    title: semanticTitle(first.category, groups),
    category: first.category,
    summary: summarize(actions, groups),
    startedAt: first.at,
    finishedAt: actions.at(-1)!.at,
    groups,
    actions,
  };
}
function stepsFromActions(actions: SessionFlowAction[]): SessionFlowStep[] {
  const groups: SessionFlowAction[][] = [];
  for (const action of actions) {
    const stepRef = action.ref.split(".A", 1)[0];
    const last = groups.at(-1);
    if (last && last[0]!.ref.startsWith(`${stepRef}.A`)) last.push(action);
    else groups.push([action]);
  }
  return groups.map(stepFromActions);
}

export function semanticSessionFlow(events: AgentSessionEvent[], requestedLimit = SESSION_GRAPH_EVENT_LIMIT, cwd?: string, rawBase = 0) {
  const limit = Math.max(1, Math.min(SESSION_GRAPH_EVENT_LIMIT, Math.trunc(requestedLimit) || SESSION_GRAPH_EVENT_LIMIT));
  const base = eventSequenceBase(rawBase);
  const allActions = sessionFlowActions(events, cwd, base);
  const windowActions = allActions.slice(-limit);
  const windowSteps = stepsFromActions(windowActions);
  const steps = windowSteps.slice(-STEP_LIMIT);
  const shownEvents = steps.reduce((sum, step) => sum + step.actions.length, 0);
  const totalEvents = base + events.length;
  return { totalEvents, shownEvents, omittedEvents: Math.max(0, totalEvents - shownEvents), steps };
}

export function resolveSessionFlowAction(events: AgentSessionEvent[], actionRef: string, cwd?: string, rawBase = 0): SessionFlowActionResolution | null {
  const actions = sessionFlowActions(events, cwd, rawBase);
  const wanted = actionRef.trim();
  if (!wanted) return null;
  const upper = wanted.toUpperCase();
  const index = actions.findIndex((action) => action.ref.toUpperCase() === upper || action.eventRef.toUpperCase() === upper || action.id === wanted);
  if (index < 0) return null;
  const action = actions[index]!;
  const stepRef = action.ref.split(".A", 1)[0]!;
  const stepActions = actions.filter((row) => row.ref.startsWith(`${stepRef}.A`));
  return {
    step: stepFromActions(stepActions),
    action,
    ...(actions[index - 1] ? { beforeRef: actions[index - 1]!.ref } : {}),
    ...(actions[index + 1] ? { afterRef: actions[index + 1]!.ref } : {}),
  };
}

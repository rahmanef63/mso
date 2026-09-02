import process from "node:process";
import { fit } from "./mso-agent-ui.mjs";
import { statusParts } from "./mso-agent-status.mjs";

const LABELS = {
  assistant: "Assistant",
  work: "Agent work",
  local: "Local agent",
  error: "Error",
  input: "Input",
};

function plain(value) { return String(value ?? "").replace(/\x1b\[[0-9;]*m/g, ""); }
function width(value) { return Array.from(plain(value)).length; }

function tuiColumns(output = process.stdout) {
  return Math.max(24, Number(output?.columns || 100));
}

export function sectionDivider(kind, { columns = tuiColumns(), detail = "", colors = {} } = {}) {
  const total = Math.max(24, Number(columns || 100) - 1);
  const label = LABELS[kind] || String(kind || "Section");
  const suffix = String(detail || "").replace(/[\r\n\t]+/g, " ").trim();
  const center = fit(` ${label}${suffix ? ` · ${suffix}` : ""} `, Math.max(8, total - 4));
  const remaining = Math.max(0, total - width(center));
  const leftCount = Math.min(3, Math.max(1, Math.floor(remaining * 0.08)));
  const rightCount = Math.max(0, remaining - leftCount);
  const tone = kind === "error" ? (colors.err || "")
    : kind === "local" ? (colors.c || colors.cyan || "")
      : kind === "work" ? (colors.warn || "")
        : (colors.blue || "");
  return `${tone}${"─".repeat(leftCount)}${center}${"─".repeat(rightCount)}${colors.reset || ""}`;
}

export function sectionBlock(kind, text, options = {}) {
  const body = String(text ?? "").replace(/\r/g, "");
  return `${sectionDivider(kind, options)}\n${body}`;
}

export function printSection(kind, options = {}, print = console.log) {
  print(sectionDivider(kind, options));
}

export function composerPrompt(session, colors = {}) {
  const name = String(session?.agentSession?.name || "agent").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "agent";
  return `${colors.blue || ""}${colors.bold || ""}@${name}${colors.reset || ""} ${colors.blue || ""}${colors.bold || ""}›${colors.reset || ""} `;
}

export function composerFooter(session, colors = {}, columns = tuiColumns()) {
  const permission = String(session?.permission || "ask");
  const tone = permission === "yolo" ? (colors.err || "") : permission === "auto" ? (colors.warn || "") : (colors.c || colors.cyan || "");
  const mode = `${tone}mode ${permission}${colors.reset || ""}`;
  if (session?.statusBar === false) return `${mode}${colors.dim || ""} · Tab cycle${colors.reset || ""}`;
  const parts = statusParts(session).filter((part) => !String(part).startsWith("@"));
  const raw = `mode ${permission} · ${parts.join(" · ")} · Tab cycle`;
  const fitted = fit(raw, Math.max(20, Number(columns || 100) - 2));
  const prefix = `mode ${permission}`;
  if (!fitted.startsWith(prefix)) return fitted;
  return `${tone}${prefix}${colors.reset || ""}${colors.dim || ""}${fitted.slice(prefix.length)}${colors.reset || ""}`;
}

export function composerSeparator(session, colors = {}, columns = tuiColumns()) {
  return sectionDivider("input", { columns, detail: `@${session?.agentSession?.name || "agent"}`, colors });
}

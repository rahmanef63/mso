import process from "node:process";
import { C } from "./mso-agent-runtime.mjs";
import { api } from "./mso-agent-api.mjs";
import { sectionBlock } from "./mso-agent-layout.mjs";
import { safeErrorSummary } from "./mso-agent-errors.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

export function diffLineCap(rows = process.stdout?.rows || 24) {
  const terminalRows = Number(rows) || 24;
  return Math.max(1, Math.min(terminalRows - 6, 200));
}

export function colorizeDiffLine(line, colors = {}) {
  if (!colors) return line;
  const reset = colors.reset || "";
  if (line.startsWith("@@")) {
    return colors.blue ? `${colors.blue}${line}${reset}` : line;
  }
  if (line.startsWith("+")) {
    return colors.cyan ? `${colors.cyan}${line}${reset}` : line;
  }
  if (line.startsWith("-")) {
    return colors.err ? `${colors.err}${line}${reset}` : line;
  }
  return line;
}

export function formatDiffBody(unifiedDiff, { full = false, cap = 200, colors = {} } = {}) {
  const raw = String(unifiedDiff || "").replace(/\r/g, "");
  const allLines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : (raw ? raw.split("\n") : []);
  if (!allLines.length) return "";
  const isTruncated = !full && allLines.length > cap;
  const targetLines = isTruncated ? allLines.slice(0, cap) : allLines;
  const colored = targetLines.map((line) => colorizeDiffLine(line, colors));
  if (isTruncated) {
    const withheld = allLines.length - cap;
    colored.push(`… ${withheld} more lines, use --full`);
  }
  return colored.join("\n");
}

export function actionRefFromSemantic(semantic) {
  if (!semantic || typeof semantic !== "object") return null;
  if (Number.isInteger(semantic.step) && Number.isInteger(semantic.action)) {
    return `S${semantic.step}.A${semantic.action}`;
  }
  return null;
}

export function actionRefFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  // Explicit action ref takes precedence over derived step/action numbers.
  if (typeof event.actionRef === "string" && event.actionRef.trim()) {
    return event.actionRef.trim();
  }
  if (typeof event.ref === "string" && event.ref.trim()) {
    return event.ref.trim();
  }
  if (event.semantic) {
    const fromSem = actionRefFromSemantic(event.semantic);
    if (fromSem) return fromSem;
  }
  return actionRefFromSemantic(event);
}

export function findLatestArtifactEvent(events) {
  if (!Array.isArray(events)) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.artifactRevision) return event;
  }
  return null;
}

export function extractDiffAndArtifact(data) {
  if (!data || typeof data !== "object") {
    return { diff: null, filePath: "file" };
  }
  const diff = data.diff ?? data.history?.diff ?? (data.available !== undefined ? data : null);
  const artifact = data.artifact ?? data.resolution?.action?.artifact;
  const filePath = artifact?.relativePath || artifact?.path || data.relativePath || data.path || "file";
  return { diff, filePath };
}

export function renderDiff(data, options = {}) {
  const { diff, filePath } = extractDiffAndArtifact(data);
  const colors = options.colors || C;
  const columns = options.columns;
  if (!diff || diff.available === false) {
    const reason = diff?.reason || "unavailable";
    return sectionBlock("diff", `diff unavailable: ${reason}`, { detail: filePath, colors, columns });
  }
  if (diff.changed === false) {
    return sectionBlock("diff", "file is unchanged since capture.", { detail: `${filePath} · unchanged`, colors, columns });
  }
  const full = Boolean(options.full);
  const cap = Number.isInteger(options.cap) ? options.cap : diffLineCap(options.rows);
  const formattedBody = formatDiffBody(diff.unifiedDiff, { full, cap, colors });
  const detail = `${filePath} · modified`;
  return sectionBlock("diff", formattedBody, { detail, colors, columns });
}

export async function handleDiffCommand(session, args = [], options = {}) {
  const full = args.includes("--full");
  const positional = args.filter((arg) => arg !== "--full" && !arg.startsWith("-"));
  let actionRef = positional[0]?.trim() || null;
  const sessionId = session?.agentSession?.id;
  const colors = options.colors || C;
  const print = options.print || createPrinter({ session, colors }).printBlock;
  const error = options.error || console.error;
  const fetchApi = options.api || api;

  if (!sessionId) {
    print("no active session");
    return;
  }

  if (!actionRef) {
    try {
      const res = await fetchApi(`/api/v1/agent-sessions?ref=${encodeURIComponent(sessionId)}`);
      const events = Array.isArray(res?.session?.events)
        ? res.session.events
        : (Array.isArray(session?.agentSession?.events) ? session.agentSession.events : []);
      const latestEvent = findLatestArtifactEvent(events);
      if (!latestEvent) {
        print("no captured artifact modifications in this session.");
        return;
      }
      actionRef = actionRefFromEvent(latestEvent);
      if (!actionRef) {
        print("could not resolve action reference for captured artifact.");
        return;
      }
    } catch (err) {
      error(`${colors.err || ""}${safeErrorSummary(err)}${colors.reset || ""}`);
      return;
    }
  }

  try {
    const artifactView = await fetchApi(
      `/api/v1/agent-sessions?view=artifact&id=${encodeURIComponent(sessionId)}&action_ref=${encodeURIComponent(actionRef)}`
    );
    const rendered = renderDiff(artifactView, {
      full,
      colors,
      rows: options.rows ?? process.stdout?.rows,
      columns: options.columns ?? process.stdout?.columns,
      cap: options.cap,
    });
    print(rendered);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(`${colors.err || ""}${message}${colors.reset || ""}`);
  }
}

import { OPERATOR_UI_RESOURCES } from "./ui-operator-resources";
import { widgetResourceMeta } from "./ui-config";
import { OPEN_IN_MSO_SCRIPT, openInMsoControls } from "./ui-navigation";
export { PROJECT_STATUS_URI, DIFF_VIEW_URI, VPS_STATUS_URI } from "./ui-operator-resources";
export const WORKFLOW_PROGRESS_URI = "ui://mso/workflow-progress-v2.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

const workflowProgressHtml = String.raw`<main class="mso-workflow" aria-live="polite">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: transparent; color: CanvasText; }
    .mso-workflow { min-width: 0; padding: 14px; }
    .card { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 18px; background: color-mix(in srgb, Canvas 94%, transparent); overflow: hidden; }
    .head { display: flex; gap: 12px; align-items: flex-start; padding: 14px 14px 10px; }
    .mark { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 10px; background: color-mix(in srgb, #7c3aed 18%, Canvas); font-weight: 800; }
    .title { min-width: 0; flex: 1; }
    h2 { margin: 0; font-size: 15px; line-height: 1.3; }
    .intent { margin: 4px 0 0; color: color-mix(in srgb, CanvasText 67%, transparent); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .status { flex: 0 0 auto; border-radius: 999px; padding: 4px 8px; font-size: 10px; font-weight: 750; letter-spacing: .07em; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
    .status.active { background: color-mix(in srgb, #22c55e 12%, Canvas); }
    .status.closed { background: color-mix(in srgb, CanvasText 7%, Canvas); }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: color-mix(in srgb, CanvasText 10%, transparent); border-block: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
    .metric { min-width: 0; background: Canvas; padding: 9px 11px; }
    .metric span { display: block; color: color-mix(in srgb, CanvasText 55%, transparent); font-size: 9px; text-transform: uppercase; letter-spacing: .09em; }
    .metric strong { display: block; margin-top: 2px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .steps { padding: 10px 14px 8px; }
    .steps-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .steps-head strong { font-size: 11px; }
    .steps-head span { color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 10px; }
    ol { list-style: none; margin: 0; padding: 0; }
    li { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 29px; border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent); font-size: 11px; }
    li:first-child { border-top: 0; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: color-mix(in srgb, CanvasText 35%, transparent); }
    .dot.completed { background: #22c55e; }
    .dot.failed, .dot.denied, .dot.rate_limited, .dot.invalid_args { background: #ef4444; }
    .tool { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .duration { color: color-mix(in srgb, CanvasText 50%, transparent); font-variant-numeric: tabular-nums; }
    .empty { padding: 8px 0 10px; color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 11px; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 10px 14px; }
    .connection { color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 10px; }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
    .open-direct { color: CanvasText; font-size: 10px; text-decoration: none; border-bottom: 1px solid currentColor; }
    .open-feedback { width: 100%; text-align: right; color: color-mix(in srgb, CanvasText 52%, transparent); font-size: 9px; }
    button { appearance: none; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); background: color-mix(in srgb, CanvasText 6%, Canvas); color: CanvasText; border-radius: 10px; padding: 7px 10px; min-height: 32px; font: inherit; font-size: 11px; font-weight: 650; cursor: pointer; }
    button.primary { background: color-mix(in srgb, #7c3aed 17%, Canvas); }
    button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    @media (max-width: 440px) { .mso-workflow { padding: 8px; } .head { padding: 11px 11px 8px; } .meta { grid-template-columns: 1fr 1fr; } .metric.project { grid-column: 1 / -1; } .foot { align-items: flex-end; } }
  </style>
  <section class="card" aria-label="MSO workflow progress">
    <div class="head">
      <div class="mark" aria-hidden="true">M</div>
      <div class="title"><h2>MSO workflow</h2><p class="intent" id="intent">Preparing workflow…</p></div>
      <span class="status active" id="state">ACTIVE</span>
    </div>
    <div class="meta">
      <div class="metric project"><span>Project</span><strong id="project">—</strong></div>
      <div class="metric"><span>Elapsed</span><strong id="elapsed">0s</strong></div>
      <div class="metric"><span>Steps</span><strong id="count">0</strong></div>
    </div>
    <div class="steps">
      <div class="steps-head"><strong>Recent progress</strong><span id="updated">waiting</span></div>
      <ol id="step-list"></ol><div class="empty" id="empty">Workflow initialized. Tool progress will appear here.</div>
    </div>
    <div class="foot">
      <span class="connection" id="connection">Live status</span>
      <div class="actions"><button type="button" id="refresh">Refresh</button>${openInMsoControls()}</div>
    </div>
  </section>
  <script>
    (() => {
      const stateEl = document.getElementById("state");
      const intentEl = document.getElementById("intent");
      const projectEl = document.getElementById("project");
      const elapsedEl = document.getElementById("elapsed");
      const countEl = document.getElementById("count");
      const listEl = document.getElementById("step-list");
      const emptyEl = document.getElementById("empty");
      const updatedEl = document.getElementById("updated");
      const connectionEl = document.getElementById("connection");
      const refreshButton = document.getElementById("refresh");
      let workflowId = "";
      let startedAt = "";
      let active = true;
      let timer = 0;
      const pending = new Map();
      let nextRequestId = 1;

      function safeText(value, fallback = "—") {
        return typeof value === "string" && value.trim() ? value.trim() : fallback;
      }
      function formatDuration(ms) {
        const total = Math.max(0, Math.floor(Number(ms) || 0));
        if (total < 1000) return total + "ms";
        const seconds = Math.floor(total / 1000);
        if (seconds < 60) return seconds + "s";
        const minutes = Math.floor(seconds / 60);
        return minutes + "m " + (seconds % 60) + "s";
      }
      function elapsedMs() {
        const parsed = Date.parse(startedAt);
        return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
      }
      function render(data) {
        if (!data || typeof data !== "object") return;
        const workflow = data.workflow && typeof data.workflow === "object" ? data.workflow : data;
        workflowId = safeText(workflow.workflowId || workflow.id || data.workflowId, workflowId);
        startedAt = safeText(workflow.startedAt || data.startedAt, startedAt);
        if (typeof data.active === "boolean") active = data.active;
        intentEl.textContent = safeText(workflow.intent || data.intent, "Workflow initialized");
        const bootstrapProject = data.bootstrap && data.bootstrap.project && typeof data.bootstrap.project === "object" ? (data.bootstrap.project.path || data.bootstrap.project.hint) : "";
        projectEl.textContent = safeText(workflow.project || data.project || bootstrapProject, "Not specified");
        const steps = Array.isArray(data.steps) ? data.steps : (Array.isArray(workflow.steps) ? workflow.steps : []);
        countEl.textContent = String(Number.isFinite(data.stepCount) ? data.stepCount : steps.length);
        stateEl.textContent = active ? "ACTIVE" : "CLOSED";
        stateEl.className = "status " + (active ? "active" : "closed");
        listEl.textContent = "";
        const recent = steps.slice(-7).reverse();
        emptyEl.hidden = recent.length > 0;
        for (const step of recent) {
          const li = document.createElement("li");
          const dot = document.createElement("span");
          dot.className = "dot " + safeText(step.state, "completed");
          const tool = document.createElement("span");
          tool.className = "tool";
          tool.textContent = safeText(step.tool, "tool");
          const duration = document.createElement("span");
          duration.className = "duration";
          duration.textContent = step.durationMs == null ? safeText(step.state, "") : formatDuration(step.durationMs);
          li.append(dot, tool, duration);
          listEl.append(li);
        }
        updatedEl.textContent = "updated now";
        elapsedEl.textContent = formatDuration(Number(data.elapsedMs) || elapsedMs());
        if (!active) stopPolling();
      }
      function postMessageCall(name, args) {
        const id = nextRequestId++;
        window.parent.postMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, "*");
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          window.setTimeout(() => {
            const request = pending.get(id);
            if (!request) return;
            pending.delete(id);
            reject(new Error("status timeout"));
          }, 8000);
        });
      }
      async function callStatus() {
        if (!workflowId || !active || document.visibilityState === "hidden") return;
        refreshButton.disabled = true;
        try {
          const result = window.openai && typeof window.openai.callTool === "function"
            ? await window.openai.callTool("workflow_status", { workflow_id: workflowId })
            : await postMessageCall("workflow_status", { workflow_id: workflowId });
          const payload = result && result.structuredContent ? result.structuredContent : result;
          render(payload);
          connectionEl.textContent = active ? "Live status" : "Workflow closed";
        } catch (_) {
          connectionEl.textContent = "Status refresh unavailable";
        } finally {
          refreshButton.disabled = false;
        }
      }
      function startPolling() {
        stopPolling();
        if (!active) return;
        timer = window.setInterval(callStatus, 4000);
      }
      function stopPolling() {
        if (timer) window.clearInterval(timer);
        timer = 0;
      }
      function readHostOutput() {
        const output = window.openai && window.openai.toolOutput;
        if (output) render(output);
      }
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.id !== undefined && pending.has(message.id)) {
          const request = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) request.reject(message.error); else request.resolve(message.result);
          return;
        }
        if (message.method === "ui/notifications/tool-result" && message.params && message.params.structuredContent) {
          render(message.params.structuredContent);
        }
      }, { passive: true });
      window.addEventListener("openai:set_globals", readHostOutput, { passive: true });
      refreshButton.addEventListener("click", callStatus);
      ${OPEN_IN_MSO_SCRIPT}
      const clock = window.setInterval(() => { elapsedEl.textContent = formatDuration(elapsedMs()); }, 1000);
      window.addEventListener("pagehide", () => { stopPolling(); window.clearInterval(clock); }, { once: true });
      readHostOutput();
      startPolling();
    })();
  </script>
</main>`;

export type McpUiResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
  _meta: Record<string, unknown>;
};

function workflowResourceMeta(): Record<string, unknown> {
  return widgetResourceMeta("Authoritative MSO workflow progress card. It shows only high-level workflow state and recent tool outcomes; do not repeat the card contents verbatim.");
}

const RESOURCES: readonly McpUiResource[] = [
  {
    uri: WORKFLOW_PROGRESS_URI,
    name: "MSO workflow progress",
    description: "Compact live progress for an authenticated MSO workflow.",
    mimeType: MCP_APP_MIME_TYPE,
    text: workflowProgressHtml,
    _meta: workflowResourceMeta(),
  },
  ...OPERATOR_UI_RESOURCES,
];

export function listUiResources() {
  return RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }));
}

export function readUiResource(uri: string): McpUiResource | undefined {
  return RESOURCES.find((resource) => resource.uri === uri);
}

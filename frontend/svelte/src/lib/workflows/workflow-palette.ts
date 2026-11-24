import type { NodeConfigFieldSpec, WorkflowNodeType, WorkflowPaletteItem } from "./workflow-types.ts";

export const WORKFLOW_PALETTE_ITEMS: readonly WorkflowPaletteItem[] = [
  {
    id: "trigger-manual", type: "manual", title: "Manual Trigger", category: "Triggers", badge: "Manual",
    description: "Start a run on demand from the studio, CLI, or MCP.",
    defaultName: "Manual Trigger", defaults: {},
  },
  {
    id: "trigger-webhook", type: "webhook", title: "Webhook Trigger", category: "Triggers", badge: "Webhook",
    description: "Receive an inbound HTTP webhook payload.",
    defaultName: "HTTP Webhook", defaults: { methods: ["POST"], responseMode: "onReceived", path: "/hook/incoming" },
  },
  {
    id: "trigger-cron", type: "schedule", title: "Cron Schedule", category: "Triggers", badge: "Cron",
    description: "Run on a server-side cron schedule or minute interval.",
    defaultName: "Cron Schedule", defaults: { mode: "cron", cron: "*/15 * * * *", timezone: "UTC" },
  },
  {
    id: "action-http", type: "integration", title: "HTTP Request", category: "Actions", badge: "HTTP",
    description: "Call an external endpoint or verified integration route.",
    defaultName: "HTTP Request", defaults: { kind: "http", method: "POST", url: "https://api.example.com/events", timeoutMs: 10000 },
  },
  {
    id: "action-host", type: "tool", title: "Shell / Host Action", category: "Actions", badge: "Host",
    description: "Execute a bounded MSO host tool or shell check.",
    defaultName: "Host Check", defaults: { kind: "host", tool: "sys_stats", command: "uptime", cwd: "." },
  },
  {
    id: "ai-agent", type: "agent", title: "AI Agent", category: "AI", badge: "AI Agent",
    description: "Run an MSO agent step with a scoped prompt and tool budget.",
    defaultName: "AI Agent", defaults: { prompt: "Summarize the input and produce structured output.", max_scope: "write", wait: true },
  },
  {
    id: "flow-condition", type: "condition", title: "Condition / Branch", category: "Flow", badge: "Branch",
    description: "Route execution along true or false output ports.",
    defaultName: "Condition", defaults: { path: "input.ok", equals: "true" },
  },
  {
    id: "flow-transform", type: "merge", title: "Transform", category: "Flow", badge: "Transform",
    description: "Combine and reshape upstream payloads for downstream steps.",
    defaultName: "Transform Payload", defaults: { mode: "combine", template: "{{input}}" },
  },
  {
    id: "flow-delay", type: "wait", title: "Delay", category: "Flow", badge: "Delay",
    description: "Pause execution for a fixed duration in milliseconds.",
    defaultName: "Delay", defaults: { delayMs: 5000 },
  },
  {
    id: "action-notify", type: "channel_send", title: "Notify", category: "Actions", badge: "Notify",
    description: "Send a notification message through a configured MSO channel.",
    defaultName: "Send Notification", defaults: { channelId: "ops-alerts", text: "Workflow notification delivered." },
  },
  {
    id: "flow-output", type: "output", title: "Output", category: "Flow", badge: "Output",
    description: "Collect and return the final workflow result payload.",
    defaultName: "Output", defaults: { format: "json" },
  },
];

export function configFieldsForNode(type: WorkflowNodeType): NodeConfigFieldSpec[] {
  if (type === "webhook") {
    return [
      { key: "path", label: "Webhook path", kind: "text", placeholder: "/hook/incoming" },
      { key: "responseMode", label: "Response mode", kind: "select", options: ["onReceived", "lastNode"] },
    ];
  }
  if (type === "schedule") {
    return [
      { key: "mode", label: "Schedule mode", kind: "select", options: ["cron", "interval"] },
      { key: "cron", label: "Cron expression (5 fields)", kind: "text", placeholder: "*/15 * * * *" },
      { key: "everyMinutes", label: "Interval (minutes)", kind: "number", placeholder: "60" },
      { key: "timezone", label: "Timezone", kind: "text", placeholder: "UTC" },
    ];
  }
  if (type === "integration") {
    return [
      { key: "method", label: "HTTP method", kind: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { key: "url", label: "Endpoint URL", kind: "text", placeholder: "https://api.example.com/hook" },
      { key: "timeoutMs", label: "Timeout (ms)", kind: "number", placeholder: "10000" },
    ];
  }
  if (type === "tool" || type === "script") {
    return [
      { key: "tool", label: "Tool / Action ID", kind: "text", placeholder: "sys_stats" },
      { key: "command", label: "Command / Arguments", kind: "text", placeholder: "uptime" },
      { key: "path", label: "Target path (optional)", kind: "text", placeholder: "reports/summary.md" },
      { key: "cwd", label: "Working directory", kind: "text", placeholder: "." },
    ];
  }
  if (type === "agent") {
    return [
      { key: "prompt", label: "Agent prompt", kind: "textarea", placeholder: "Describe what the agent should do..." },
      { key: "max_scope", label: "Max scope", kind: "select", options: ["read", "write", "exec"] },
      { key: "wait", label: "Wait for completion", kind: "checkbox" },
    ];
  }
  if (type === "condition" || type === "switch") {
    return [
      { key: "path", label: "Value path", kind: "text", placeholder: "input.ok" },
      { key: "equals", label: "Expected value", kind: "text", placeholder: "true" },
    ];
  }
  if (type === "merge") {
    return [
      { key: "mode", label: "Transform mode", kind: "select", options: ["combine", "pick", "template"] },
      { key: "template", label: "Mapping / template", kind: "textarea", placeholder: "{{input}}" },
    ];
  }
  if (type === "wait") {
    return [{ key: "delayMs", label: "Delay (ms)", kind: "number", placeholder: "5000" }];
  }
  if (type === "channel_send") {
    return [
      { key: "channelId", label: "Channel ID", kind: "text", placeholder: "ops-alerts" },
      { key: "text", label: "Message text", kind: "textarea", placeholder: "Workflow alert message" },
    ];
  }
  if (type === "output") {
    return [{ key: "format", label: "Output format", kind: "select", options: ["json", "text", "markdown"] }];
  }
  return [];
}

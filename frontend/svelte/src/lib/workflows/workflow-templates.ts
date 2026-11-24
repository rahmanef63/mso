import type { WorkflowStarterTemplate } from "./workflow-types.ts";

export { configFieldsForNode, WORKFLOW_PALETTE_ITEMS } from "./workflow-palette.ts";

export const WORKFLOW_STARTER_TEMPLATES: readonly WorkflowStarterTemplate[] = [
  {
    id: "blank",
    title: "Blank Workflow",
    subtitle: "Manual -> Output",
    description: "Minimal two-node graph ready for custom wiring.",
    tags: ["starter"],
    build: () => ({
      name: "New Workflow",
      description: "Custom automation workflow.",
      status: "draft",
      inputs: {},
      metadata: { provenance: "user", tags: ["starter"], timezone: "UTC" },
      nodes: [
        { id: "trigger-1", name: "Manual Trigger", type: "manual", position: { x: 64, y: 140 }, config: {} },
        { id: "output-1", name: "Output", type: "output", position: { x: 340, y: 140 }, config: { format: "json" } },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "output-1" }],
    }),
  },
  {
    id: "webhook-transform-notify",
    title: "Webhook -> Transform -> Notify",
    subtitle: "HTTP Webhook -> Transform -> Notify",
    description: "Ingest an HTTP webhook, normalize its payload, and notify an ops channel.",
    tags: ["webhook", "notify"],
    build: () => ({
      name: "Webhook Alert Pipeline",
      description: "Receive an HTTP webhook, transform the payload, and send a notification.",
      status: "draft",
      inputs: {},
      metadata: { provenance: "template", tags: ["webhook", "notify"], timezone: "UTC" },
      nodes: [
        {
          id: "webhook-1", name: "HTTP Webhook", type: "webhook",
          position: { x: 48, y: 140 },
          config: { methods: ["POST"], responseMode: "onReceived", path: "/hook/alerts" },
        },
        {
          id: "transform-1", name: "Transform Payload", type: "merge",
          position: { x: 300, y: 140 },
          config: { mode: "combine", template: "Alert: {{input.summary}}" },
        },
        {
          id: "notify-1", name: "Notify Channel", type: "channel_send",
          position: { x: 552, y: 140 },
          config: { channelId: "ops-alerts", text: "{{nodes.transform-1.output}}" },
        },
      ],
      edges: [
        { id: "edge-1", source: "webhook-1", target: "transform-1" },
        { id: "edge-2", source: "transform-1", target: "notify-1" },
      ],
    }),
  },
  {
    id: "cron-host-alert",
    title: "Cron -> Host Check -> Alert",
    subtitle: "Cron -> Host Check -> Alert",
    description: "Run a scheduled host health check and alert when a threshold fails.",
    tags: ["cron", "ops", "alert"],
    build: () => ({
      name: "Scheduled Host Check",
      description: "Check host health on a cron schedule and alert if unhealthy.",
      status: "draft",
      inputs: {},
      metadata: { provenance: "template", tags: ["cron", "ops"], timezone: "UTC" },
      nodes: [
        {
          id: "cron-1", name: "Every 15 Min", type: "schedule",
          position: { x: 48, y: 150 },
          config: { mode: "cron", cron: "*/15 * * * *", timezone: "UTC" },
        },
        {
          id: "host-1", name: "Host Check", type: "tool",
          position: { x: 296, y: 150 },
          config: { kind: "host", tool: "sys_stats", command: "uptime", cwd: "." },
        },
        {
          id: "check-1", name: "Is Unhealthy", type: "condition",
          position: { x: 544, y: 150 },
          config: { path: "nodes.host-1.output.ok", equals: "false" },
        },
        {
          id: "alert-1", name: "Send Alert", type: "channel_send",
          position: { x: 792, y: 100 },
          config: { channelId: "ops-alerts", text: "Host health check failed." },
        },
      ],
      edges: [
        { id: "edge-1", source: "cron-1", target: "host-1" },
        { id: "edge-2", source: "host-1", target: "check-1" },
        { id: "edge-3", source: "check-1", target: "alert-1", sourceHandle: "true" },
      ],
    }),
  },
  {
    id: "manual-agent-write",
    title: "Manual -> AI Agent -> Write File",
    subtitle: "Manual -> AI Agent -> Write File",
    description: "Run an AI agent from a manual trigger and persist its report to a workspace file.",
    tags: ["ai", "files"],
    build: () => ({
      name: "AI Report Writer",
      description: "Generate a structured report with an AI agent and write it to disk.",
      status: "draft",
      inputs: {},
      metadata: { provenance: "template", tags: ["ai", "files"], timezone: "UTC" },
      nodes: [
        { id: "manual-1", name: "Manual Trigger", type: "manual", position: { x: 48, y: 140 }, config: {} },
        {
          id: "agent-1", name: "AI Agent", type: "agent",
          position: { x: 300, y: 140 },
          config: { prompt: "Inspect workspace status and draft a concise markdown report.", max_scope: "write", wait: true },
        },
        {
          id: "write-1", name: "Write File", type: "tool",
          position: { x: 552, y: 140 },
          config: { kind: "host", tool: "fs_write", path: "reports/summary.md", cwd: "." },
        },
      ],
      edges: [
        { id: "edge-1", source: "manual-1", target: "agent-1" },
        { id: "edge-2", source: "agent-1", target: "write-1" },
      ],
    }),
  },
];

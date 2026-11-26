// Declarative feature contract registry for MSO Svelte 5 UI modules under frontend/svelte/src/lib/.
export type SurfaceKind = "shell" | "frame" | "iframe" | "support";

export const FEATURE_CONTRACTS: Record<string, { surfaceKind: SurfaceKind; description: string }> = {
  "agent-group": { surfaceKind: "frame", description: "Multi-agent group discussion workspace" },
  "agent-vault": { surfaceKind: "frame", description: "Private repo Obsidian-compatible agent vault" },
  assistant: { surfaceKind: "frame", description: "Alfa assistant chat, sessions, and tool activity" },
  auth: { surfaceKind: "support", description: "Login, session state, and device approval helpers" },
  catalog: { surfaceKind: "frame", description: "App Store and Extensions catalog" },
  "create-app": { surfaceKind: "frame", description: "Create App manifest authoring surface" },
  creative: { surfaceKind: "frame", description: "Image Editor, Media Studio, and Reel Editor" },
  demo: { surfaceKind: "support", description: "Offline synthetic demo fetch adapter and viewport preview banner" },
  docs: { surfaceKind: "frame", description: "In-app documentation viewer" },
  editor: { surfaceKind: "frame", description: "Code and text editor" },
  files: { surfaceKind: "frame", description: "VPS filesystem browser and editor" },
  infra: { surfaceKind: "frame", description: "Dokploy and Cloudflare infrastructure manager" },
  integrations: { surfaceKind: "iframe", description: "Integrations and Channels workspace" },
  "managed-apps": { surfaceKind: "frame", description: "AppDeck managed OSS app lifecycle manager" },
  media: { surfaceKind: "frame", description: "Media viewer and icon/image pickers" },
  "memory-graph": { surfaceKind: "frame", description: "Interactive knowledge and memory graph" },
  monitor: { surfaceKind: "frame", description: "System monitor, processes, services, and packages" },
  organization: { surfaceKind: "frame", description: "Organization chart and execution bindings" },
  "runtime-apps": { surfaceKind: "iframe", description: "Camoufox browser, Bot Desktops, n8n, and T3 workspaces" },
  settings: { surfaceKind: "frame", description: "MSO Settings, security, backup, and updates" },
  shell: { surfaceKind: "shell", description: "Desktop/mobile window manager, dock, and command palette" },
  terminal: { surfaceKind: "frame", description: "Interactive PTY terminal" },
  workflows: { surfaceKind: "frame", description: "Native SVG workflow graph editor and runner" },
};

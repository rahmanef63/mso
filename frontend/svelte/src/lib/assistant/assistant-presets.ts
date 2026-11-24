import type { PlaybookPreset } from "./assistant-types.ts";

export const DEFAULT_STARTERS: readonly string[] = [
  "Show system stats and host uptime",
  "List projects in ~/projects",
  "Check active services and running processes",
  "Inspect recent logs for errors or warnings",
  "List available local skills on this host",
  "Summarize disk and memory usage",
];

export const BUILTIN_PLAYBOOKS: readonly PlaybookPreset[] = [
  {
    id: "pb_sysadmin",
    name: "Sysadmin",
    summary: "Operate the VPS: check metrics, processes, services, and safe diagnostics.",
    instructions:
      "Focus on concrete Linux host diagnostics: check metrics, services, logs, and processes. Explain risk before any mutating command.",
    starters: [
      "Show system stats and top processes",
      "Check if any systemd service failed recently",
      "Summarize memory and disk usage",
    ],
  },
  {
    id: "pb_files",
    name: "Files & Projects",
    summary: "Navigate workspaces, inspect configs, and summarize repositories cleanly.",
    instructions:
      "Focus on reading files, inspecting directory layouts, and summarizing project configs without unnecessary edits.",
    starters: [
      "List ~/projects and summarize what is active",
      "Inspect package.json scripts in the main project",
      "Find recently modified files in ~/projects",
    ],
  },
  {
    id: "pb_harness",
    name: "Harness & Skills",
    summary: "Discover local skills, follow verified playbooks, and keep steps crisp.",
    instructions:
      "Discover local skills first, use trusted host capabilities, and report concise evidence-based outcomes.",
    starters: [
      "List available local skills",
      "Explain which read tools are enabled",
      "Check recent agent sessions on this host",
    ],
  },
  {
    id: "pb_browser",
    name: "Browser Ops",
    summary: "Plan web checks, inspect endpoints, and verify UI health safely.",
    instructions:
      "Focus on HTTP/browser verification, endpoint checks, and structured reproduction steps.",
    starters: [
      "Check if the local cockpit health endpoint is OK",
      "Outline a quick smoke check for the web app",
      "Inspect reverse-proxy or port status",
    ],
  },
];

export function findPlaybook(id: string | null): PlaybookPreset | null {
  if (!id) return null;
  return BUILTIN_PLAYBOOKS.find((item) => item.id === id) ?? null;
}

export function formatRelativeTime(raw?: number | string, now = Date.now()): string {
  if (raw === undefined || raw === null || raw === "") return "";
  const ms = typeof raw === "number" ? raw : Date.parse(raw);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const diffSec = Math.max(0, Math.floor((now - ms) / 1000));
  if (diffSec < 45) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(ms).toLocaleDateString();
}

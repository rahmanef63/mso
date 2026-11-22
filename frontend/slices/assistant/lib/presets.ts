import type { Agent, Automation, Skill } from "./types";

// Icon names map to lucide icons in components/icon-map.ts. Colors are Tailwind
// palette utility classes (theme tokens, not raw hex) applied to avatars.
export const SKILL_ICONS = [
  "folder",
  "globe",
  "film",
  "image",
  "gauge",
  "settings",
  "code",
  "cloud",
  "music",
  "grid",
  "file",
  "sparkles",
  "terminal",
] as const;

export const AGENT_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-emerald-500",
  "bg-amber-500",
] as const;

export const SKILL_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-emerald-500",
  "bg-fuchsia-500",
] as const;

export const PRESET_SKILLS: Skill[] = [
  {
    id: "sk_files",
    builtin: true,
    name: "File Ops",
    glyph: "folder",
    color: "bg-blue-500",
    instructions:
      "Organize the filesystem: create, rename, move, delete, search and open files and folders.",
    tools: ["fs.list", "fs.mkdir", "fs.write", "fs.move", "fs.delete", "fs.read", "fs.search"],
    starters: ["Create a folder Renders in /Media", "List everything in /Projects", "Find files named promo"],
  },
  {
    id: "sk_web",
    builtin: true,
    name: "Web Research",
    glyph: "globe",
    color: "bg-blue-500",
    instructions: "Browse the web to look things up. Open URLs, run searches, and bookmark useful pages.",
    tools: ["app.open", "fs.write"],
    starters: ["Open browser to wikipedia.org", "Search the web for remotion templates", "Bookmark this page"],
  },
  {
    id: "sk_sys",
    builtin: true,
    name: "Sysadmin",
    glyph: "gauge",
    color: "bg-emerald-500",
    instructions:
      "Operate the VPS: read system stats, list processes, run shell commands, and tune appearance/settings.",
    tools: ["sys.stats", "sys.processes", "exec.run", "app.open"],
    starters: ["Show system stats", "Run df then ps", "Switch to dark mode"],
  },
  {
    id: "sk_harness",
    builtin: true,
    name: "Harness",
    glyph: "sparkles",
    color: "bg-violet-500",
    instructions:
      "Discover local skills, read their instructions, remember durable facts, and delegate work through approved host commands.",
    tools: ["skills.list", "skills.read", "memory.remember", "memory.forget", "exec.run"],
    starters: ["List available local skills", "Read the camoufox-browse skill", "Remember this preference"],
  },
  {
    id: "sk_browser_ops",
    builtin: true,
    name: "Browser Ops",
    glyph: "globe",
    color: "bg-teal-500",
    instructions:
      "Use the built-in browser plus local Camoufox/OpenClaw browser automation scripts when approved.",
    tools: ["app.open", "skills.list", "skills.read", "exec.run"],
    starters: ["Open a URL", "Check if camoufox-browse is installed", "Run a browser smoke check"],
  },
];

export const PRESET_AGENTS: Agent[] = [
  {
    id: "ag_alfa",
    builtin: true,
    name: "Alfa",
    glyph: "sparkles",
    color: "bg-violet-500",
    persona:
      "Alfa is the MSO harness agent: calm, precise, and proactive. It can discover local skills, chain approved tools, operate this VPS through MSO, and narrate only what matters.",
    allTools: true,
    skills: [],
  },
  {
    id: "ag_ops",
    builtin: true,
    name: "Ops",
    glyph: "gauge",
    color: "bg-emerald-500",
    persona: "A no-nonsense sysadmin. Prefers concrete shell commands and explains the risk before destructive ops.",
    allTools: false,
    skills: ["sk_sys", "sk_files"],
  },
];

export const PRESET_AUTOMATIONS: Automation[] = [
  {
    id: "au_setup",
    builtin: true,
    name: "Daily Setup",
    glyph: "gauge",
    color: "bg-emerald-500",
    agentId: "ag_alfa",
    steps: [
      { tool: "fs.mkdir", argText: "/Projects" },
      { tool: "app.open", argText: "files" },
      { tool: "sys.stats", argText: "" },
    ],
  },
];

import {
  Folder,
  Globe,
  Code,
  Terminal,
  Image,
  Clapperboard,
  Eye,
  Store,
  PlusSquare,
  Gauge,
  Sparkles,
  Settings,
  Search,
  PanelRight,
  Bell,
  SlidersHorizontal,
  LayoutGrid,
  Cloud,
  ServerCog,
  Plug,
  MessageSquareMore,
  Users,
  Workflow,
  Bot,
  Code2,
  SquareCode,
} from "lucide-react";
import type { SystemEntry } from "./store-catalog";

// The built-in apps + shell features the owner can turn on/off from the store.
// This is the canonical toggle list — it must include items even while they are
// disabled (so they can be re-enabled), which is why it can't be derived from the
// live registry (the registry only holds ENABLED apps). `id` MUST match the
// AppDescriptor.id / FeatureDescriptor.id in shell.manifest.ts so os-root can
// filter the manifest by the disabled set. Pure data — no React.
// The row shape is the shared `SystemEntry` in store-catalog.ts, so built-ins and
// curated apps share one metadata model.

export type { SystemKind, SystemEntry } from "./store-catalog";

export const SYSTEM_CATALOG: SystemEntry[] = [
  // ── Built-in apps ─────────────────────────────────────────────────────────
  { id: "integrations", title: "Integrations", kind: "app", icon: Plug, gradient: "var(--primary)", desc: "Manage native service accounts, connections, and private setup." },
  { id: "channels", title: "Channels", kind: "app", icon: MessageSquareMore, gradient: "var(--primary)", desc: "Connect Telegram and Discord to MSO Workflows and outbound messaging." },
  { id: "agent-group", title: "Agent groups", kind: "app", icon: Users, gradient: "var(--primary)", desc: "Let several Hermes profiles discuss a topic in turn and mirror into a Telegram group." },
  { id: "files-manager", title: "Files", kind: "app", icon: Folder, gradient: "linear-gradient(160deg,#3aa0ff,#1f6dff)", desc: "Browse, upload, and manage host files." },
  { id: "browser", title: "Browser", kind: "app", icon: Globe, gradient: "linear-gradient(160deg,#22b1ff,#1666e0)", desc: "Tabbed web viewer: pages render in a sandboxed embedded frame." },
  { id: "code-editor", title: "Code", kind: "app", icon: Code, gradient: "linear-gradient(160deg,#7a5cff,#4f2fd6)", desc: "Edit host files in a tabbed code editor." },
  { id: "os-terminal", title: "Terminal", kind: "app", icon: Terminal, gradient: "linear-gradient(160deg,#2b2f3a,#11141b)", desc: "Run shell commands on the host." },
  { id: "media-studio", title: "Image Editor", kind: "app", icon: Image, gradient: "linear-gradient(160deg,#ff8a3d,#ff5fa2)", desc: "Layered canvas image editing." },
  { id: "reel-editor", title: "Video Editor", kind: "app", icon: Clapperboard, gradient: "linear-gradient(160deg,#ff5fa2,#b13bff)", desc: "Timeline-based reel editing." },
  { id: "media-viewer", title: "Preview", kind: "app", icon: Eye, gradient: "linear-gradient(160deg,#34d39a,#0f9e6a)", desc: "Quick-look images and media." },
  { id: "create-app", title: "Create App", kind: "app", icon: PlusSquare, gradient: "linear-gradient(160deg,#16c2c2,#0a8a8a)", desc: "Author a custom runtime app." },
  { id: "system-monitor", title: "System Monitor", kind: "app", icon: Gauge, gradient: "linear-gradient(160deg,#f25f5c,#c0392b)", desc: "Live CPU, memory, and disk telemetry." },
  { id: "assistant", title: "Alfa", kind: "app", icon: Sparkles, gradient: "linear-gradient(160deg,#7a5cff,#3aa0ff)", desc: "AI copilot for your VPS." },
  { id: "dokploy", title: "Dokploy", kind: "app", icon: ServerCog, artwork: "/brand/official/dokploy.webp", gradient: "linear-gradient(160deg,#111827,#2563eb)", desc: "Deploy and manage projects through the Dokploy API." },
  { id: "cloudflare", title: "Cloudflare", kind: "app", icon: Cloud, artwork: "/brand/official/cloudflare.webp", gradient: "linear-gradient(160deg,#1f2937,#111827)", desc: "Verify Cloudflare access and inspect DNS zones." },
  { id: "workflows", title: "Workflows", kind: "app", icon: Workflow, gradient: "linear-gradient(160deg,#6366f1,#4338ca)", desc: "Native MSO visual workflow graphs and executions." },
  { id: "n8n", title: "n8n", kind: "app", icon: Workflow, artwork: "/brand/official/n8n.webp", gradient: "linear-gradient(160deg,#ea4b71,#ff6d5a)", desc: "External n8n workspace with MSO install, updates, and SSH/remote connect." },
  { id: "hermes", title: "Hermes", kind: "app", icon: Bot, artwork: "/brand/official/hermes.webp", gradient: "linear-gradient(160deg,#8b5cf6,#4f46e5)", desc: "Hermes Agent runtime and dashboard." },
  { id: "openclaw", title: "OpenClaw", kind: "app", icon: Workflow, artwork: "/brand/official/openclaw.webp", gradient: "linear-gradient(160deg,#f97316,#dc2626)", desc: "OpenClaw runtime and control surface." },
  { id: "9router", title: "9Router", kind: "app", icon: Globe, artwork: "/brand/official/9router.webp", gradient: "linear-gradient(160deg,#0ea5e9,#2563eb)", desc: "9Router AI gateway across providers." },
  { id: "orca", title: "Orca", kind: "app", icon: SquareCode, artwork: "/brand/official/orca.webp", gradient: "linear-gradient(160deg,#0284c7,#1e3a8a)", desc: "Orca web workspace and coding environment." },
  { id: "t3", title: "T3 Code", kind: "app", icon: Code2, artwork: "/brand/official/t3.webp", gradient: "linear-gradient(160deg,#18181b,#4f46e5)", desc: "T3 Code multi-agent coding workspace." },
  { id: "os-settings", title: "Settings", kind: "app", icon: Settings, gradient: "linear-gradient(160deg,#5b6070,#2b2f3a)", desc: "Appearance, server mode, devices." },
  { id: "app-store", title: "App Store", kind: "app", icon: Store, gradient: "linear-gradient(160deg,#9b5cff,#5b2fe0)", desc: "Install apps and toggle features.", required: true },
  // ── Shell features ────────────────────────────────────────────────────────
  { id: "search", title: "Spotlight", kind: "feature", icon: Search, gradient: "linear-gradient(160deg,#6b7280,#374151)", desc: "⌘K command palette: open apps, run actions, search files." },
  { id: "inspector", title: "AI Inspector", kind: "feature", icon: PanelRight, gradient: "linear-gradient(160deg,#7a5cff,#4f2fd6)", desc: "Right-docked properties panel + scoped AI chat (⌘I)." },
  { id: "notifications", title: "Notifications", kind: "feature", icon: Bell, gradient: "linear-gradient(160deg,#f25f5c,#c0392b)", desc: "Toast stack + iOS dynamic-island live activities." },
  { id: "control-center", title: "Control Center", kind: "feature", icon: SlidersHorizontal, gradient: "linear-gradient(160deg,#22b1ff,#1666e0)", desc: "Mobile quick toggles (swipe down from the top)." },
  { id: "widgets", title: "Widgets", kind: "feature", icon: LayoutGrid, gradient: "linear-gradient(160deg,#34d39a,#0f9e6a)", desc: "Mobile Today view with live system widgets." },
];

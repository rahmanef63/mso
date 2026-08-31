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
  type LucideIcon,
} from "lucide-react";

// The built-in apps + shell features the owner can turn on/off from the store.
// This is the canonical toggle list — it must include items even while they are
// disabled (so they can be re-enabled), which is why it can't be derived from the
// live registry (the registry only holds ENABLED apps). `id` MUST match the
// AppDescriptor.id / FeatureDescriptor.id in shell.manifest.ts so os-root can
// filter the manifest by the disabled set. Pure data — no React.

export type SystemKind = "app" | "feature";

export type SystemEntry = {
  id: string;
  title: string;
  kind: SystemKind;
  icon: LucideIcon;
  gradient: string;
  desc: string;
  required?: boolean; // can never be disabled (the App Store itself)
};

export const SYSTEM_CATALOG: SystemEntry[] = [
  // ── Built-in apps ─────────────────────────────────────────────────────────
  { id: "files-manager", title: "Files", kind: "app", icon: Folder, gradient: "linear-gradient(160deg,#3aa0ff,#1f6dff)", desc: "Browse, upload, and manage host files." },
  { id: "browser", title: "Browser", kind: "app", icon: Globe, gradient: "linear-gradient(160deg,#22b1ff,#1666e0)", desc: "Tabbed web viewer — pages render in a sandboxed embedded frame." },
  { id: "code-editor", title: "Code", kind: "app", icon: Code, gradient: "linear-gradient(160deg,#7a5cff,#4f2fd6)", desc: "Edit host files in a tabbed code editor." },
  { id: "os-terminal", title: "Terminal", kind: "app", icon: Terminal, gradient: "linear-gradient(160deg,#2b2f3a,#11141b)", desc: "Run shell commands on the host." },
  { id: "media-studio", title: "Image Editor", kind: "app", icon: Image, gradient: "linear-gradient(160deg,#ff8a3d,#ff5fa2)", desc: "Layered canvas image editing." },
  { id: "reel-editor", title: "Video Editor", kind: "app", icon: Clapperboard, gradient: "linear-gradient(160deg,#ff5fa2,#b13bff)", desc: "Timeline-based reel editing." },
  { id: "media-viewer", title: "Preview", kind: "app", icon: Eye, gradient: "linear-gradient(160deg,#34d39a,#0f9e6a)", desc: "Quick-look images and media." },
  { id: "create-app", title: "Create App", kind: "app", icon: PlusSquare, gradient: "linear-gradient(160deg,#16c2c2,#0a8a8a)", desc: "Author a custom runtime app." },
  { id: "system-monitor", title: "System Monitor", kind: "app", icon: Gauge, gradient: "linear-gradient(160deg,#f25f5c,#c0392b)", desc: "Live CPU, memory, and disk telemetry." },
  { id: "assistant", title: "Alfa", kind: "app", icon: Sparkles, gradient: "linear-gradient(160deg,#7a5cff,#3aa0ff)", desc: "AI copilot for your VPS." },
  { id: "dokploy", title: "Dokploy", kind: "app", icon: ServerCog, gradient: "linear-gradient(160deg,#111827,#2563eb)", desc: "Deploy and manage projects through the Dokploy API." },
  { id: "cloudflare", title: "Cloudflare", kind: "app", icon: Cloud, gradient: "linear-gradient(160deg,#f59e0b,#ea580c)", desc: "Verify Cloudflare access and inspect DNS zones." },
  { id: "os-settings", title: "Settings", kind: "app", icon: Settings, gradient: "linear-gradient(160deg,#5b6070,#2b2f3a)", desc: "Appearance, server mode, devices." },
  { id: "app-store", title: "App Store", kind: "app", icon: Store, gradient: "linear-gradient(160deg,#9b5cff,#5b2fe0)", desc: "Install apps and toggle features.", required: true },
  // ── Shell features ────────────────────────────────────────────────────────
  { id: "search", title: "Spotlight", kind: "feature", icon: Search, gradient: "linear-gradient(160deg,#6b7280,#374151)", desc: "⌘K command palette: open apps, run actions, search files." },
  { id: "inspector", title: "AI Inspector", kind: "feature", icon: PanelRight, gradient: "linear-gradient(160deg,#7a5cff,#4f2fd6)", desc: "Right-docked properties panel + scoped AI chat (⌘I)." },
  { id: "notifications", title: "Notifications", kind: "feature", icon: Bell, gradient: "linear-gradient(160deg,#f25f5c,#c0392b)", desc: "Toast stack + iOS dynamic-island live activities." },
  { id: "control-center", title: "Control Center", kind: "feature", icon: SlidersHorizontal, gradient: "linear-gradient(160deg,#22b1ff,#1666e0)", desc: "Mobile quick toggles (swipe down from the top)." },
  { id: "widgets", title: "Widgets", kind: "feature", icon: LayoutGrid, gradient: "linear-gradient(160deg,#34d39a,#0f9e6a)", desc: "Mobile Today view with live system widgets." },
];

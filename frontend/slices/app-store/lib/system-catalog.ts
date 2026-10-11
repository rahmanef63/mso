import { Search, PanelRight, Bell, SlidersHorizontal, LayoutGrid } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export type SystemEntry = Pick<AppDescriptor, "id" | "title" | "icon" | "iconFill" | "gradient"> & {
  kind: "app" | "feature";
  desc: string;
  required?: boolean;
};

export const SYSTEM_FEATURES: SystemEntry[] = [
  { id: "search", title: "Spotlight", kind: "feature", icon: Search, gradient: "linear-gradient(160deg,#6b7280,#374151)", desc: "⌘K command palette: open apps, run actions, search files." },
  { id: "inspector", title: "AI Inspector", kind: "feature", icon: PanelRight, gradient: "linear-gradient(160deg,#7a5cff,#4f2fd6)", desc: "Right-docked properties panel + scoped AI chat (⌘I)." },
  { id: "notifications", title: "Notifications", kind: "feature", icon: Bell, gradient: "linear-gradient(160deg,#f25f5c,#c0392b)", desc: "Toast stack + iOS dynamic-island live activities." },
  { id: "control-center", title: "Control Center", kind: "feature", icon: SlidersHorizontal, gradient: "linear-gradient(160deg,#22b1ff,#1666e0)", desc: "Mobile quick toggles (swipe down from the top)." },
  { id: "widgets", title: "Widgets", kind: "feature", icon: LayoutGrid, gradient: "linear-gradient(160deg,#34d39a,#0f9e6a)", desc: "Mobile Today view with live system widgets." },
];

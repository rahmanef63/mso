import { Bot, Workflow, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import type { AppDescriptor, AppIconComponent } from "@/features/os-shell";

const NineRouterIcon: AppIconComponent = ({ className }) =>
  // Exact upstream 9Router artwork, copied from the managed Docker image. This file is
  // intentionally .ts (not .tsx), so use createElement rather than adding a JSX-only rename.
  createElement("img", {
    src: "/brand/official/9router.webp",
    alt: "",
    "aria-hidden": true,
    className: className ?? "size-full object-contain",
    draggable: false,
  });

type ManagedApp = "hermes" | "openclaw" | "9router";

const LOOK: Record<ManagedApp, { title: string; icon: LucideIcon | AppIconComponent; gradient: string; loader: string }> = {
  hermes: { title: "Hermes", icon: Bot, gradient: "linear-gradient(160deg,#8b5cf6,#4f46e5)", loader: "HermesApp" },
  openclaw: { title: "OpenClaw", icon: Workflow, gradient: "linear-gradient(160deg,#f97316,#dc2626)", loader: "OpenClawApp" },
  "9router": { title: "9Router", icon: NineRouterIcon, gradient: "linear-gradient(160deg,#0ea5e9,#2563eb)", loader: "NineRouterApp" },
};

// Ordinary apps, dock and all. They were `noDock` while MSO could swap its whole shell
// into a Hermes/OpenClaw "workspace mode" that opened them by itself — that is gone: each
// ships its own sidebar, so re-hosting its navigation bought nothing. One window per app.
function managedDescriptor(app: ManagedApp): AppDescriptor {
  const look = LOOK[app];
  return {
    id: app,
    title: look.title,
    icon: look.icon,
    gradient: look.gradient,
    load: async () => {
      const loaded = await import("./app");
      return { default: loaded[look.loader as "HermesApp" | "OpenClawApp" | "NineRouterApp"] };
    },
    defaultSize: { w: 1100, h: 720 },
  };
}

export const hermesApp = managedDescriptor("hermes");
export const openclawApp = managedDescriptor("openclaw");
export const nineRouterApp = managedDescriptor("9router");

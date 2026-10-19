import { Bot, SquareCode, Workflow, type LucideIcon } from "lucide-react";
import React, { createElement } from "react";
import type { AppIconComponent } from "@/features/appshell";
import type { ManagedAppId } from "@/lib/managed-apps/types";

export const NineRouterIcon: AppIconComponent = ({ className }) =>
  createElement("img", {
    src: "/brand/official/9router.webp",
    alt: "",
    "aria-hidden": true,
    className: className ?? "size-full object-contain",
    draggable: false,
  });

export interface ManagedAppMeta {
  title: string;
  gradient: string;
  loader: "HermesApp" | "OpenClawApp" | "NineRouterApp" | "OrcaApp";
  icon: LucideIcon | AppIconComponent;
  artwork?: string;
  tone?: string;
}

export const MANAGED_APP_META: Record<ManagedAppId, ManagedAppMeta> = {
  hermes: {
    title: "Hermes",
    gradient: "linear-gradient(160deg,#8b5cf6,#4f46e5)",
    loader: "HermesApp",
    icon: Bot,
    tone: "text-violet-400",
  },
  openclaw: {
    title: "OpenClaw",
    gradient: "linear-gradient(160deg,#f97316,#dc2626)",
    loader: "OpenClawApp",
    icon: Workflow,
    tone: "text-orange-400",
  },
  "9router": {
    title: "9Router",
    gradient: "linear-gradient(160deg,#0ea5e9,#2563eb)",
    loader: "NineRouterApp",
    icon: NineRouterIcon,
    artwork: "/brand/official/9router.webp",
  },
  orca: {
    title: "Orca",
    gradient: "linear-gradient(160deg,#0284c7,#1e3a8a)",
    loader: "OrcaApp",
    icon: SquareCode,
    tone: "text-sky-400",
  },
};

export const MANAGED_APP_NAMES: Record<ManagedAppId, string> = {
  hermes: MANAGED_APP_META.hermes.title,
  openclaw: MANAGED_APP_META.openclaw.title,
  "9router": MANAGED_APP_META["9router"].title,
  orca: MANAGED_APP_META.orca.title,
};

export function AppMark({ id, className }: { id: ManagedAppId; className?: string }) {
  const meta = MANAGED_APP_META[id];
  if (meta.artwork) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={meta.artwork} alt="" aria-hidden className={`${className ?? "size-4"} object-contain`} draggable={false} />;
  }
  const Icon = meta.icon as LucideIcon;
  return <Icon className={`${className ?? "size-4"} ${meta.tone ?? ""}`} />;
}

export const MANAGED_APP_ICONS: Record<ManagedAppId, React.ReactNode> = {
  hermes: <AppMark id="hermes" />,
  openclaw: <AppMark id="openclaw" />,
  "9router": <AppMark id="9router" />,
  orca: <AppMark id="orca" />,
};

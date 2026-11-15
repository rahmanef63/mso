import { MonitorPlay } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. The component is lazy-loaded via
// `load`, so this slice costs a Lucide icon in the dock until it is opened.
export const botDesktopsApp: AppDescriptor = {
  id: "bot-desktops",
  title: "Bot Desktops",
  icon: MonitorPlay,
  gradient: "linear-gradient(160deg,#0ea5e9,#1e3a8a)",
  load: () => import("./app"),
  defaultSize: { w: 980, h: 700 },
};

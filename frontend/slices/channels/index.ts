import { MessageSquareMore } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export const channelsApp: AppDescriptor = {
  id: "channels",
  title: "Channels",
  icon: MessageSquareMore,
  gradient: "var(--primary)",
  load: () => import("./app"),
  defaultSize: { w: 1120, h: 760 },
};

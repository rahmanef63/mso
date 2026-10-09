import { NotebookPen } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export const agentVaultApp: AppDescriptor = {
  id: "agent-vault", title: "Agent Vault", icon: NotebookPen, gradient: "var(--primary)",
  load: () => import("./app"), defaultSize: { w: 1000, h: 700 },
};

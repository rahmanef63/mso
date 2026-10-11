import { createElement } from "react";
import { NotebookPen, Waypoints, Network } from "lucide-react";
import type { AppDescriptor, AppProps } from "@/features/appshell";
import type { WorkspaceView } from "./lib/workspace-model";

async function loadView(initialView: WorkspaceView) {
  const { KnowledgeWorkspaceApp } = await import("./app");
  return { default: (props: AppProps) => createElement(KnowledgeWorkspaceApp, {...props, initialView}) };
}
export const agentVaultApp: AppDescriptor = {
  id:"agent-vault", title:"Agent Vault", icon:NotebookPen, gradient:"var(--primary)",
  load:()=>loadView("vault"), defaultSize:{w:1000,h:700},
};
export const memoryGraphApp: AppDescriptor = {
  id:"memory-graph", title:"Memory", icon:Waypoints, gradient:"var(--primary)",
  load:()=>loadView("memory"), defaultSize:{w:1080,h:720},
};
export const organizationApp: AppDescriptor = {
  id:"organization", title:"Organization", icon:Network, gradient:"var(--primary)", prefetch:"never",
  load:()=>loadView("organization"), defaultSize:{w:1120,h:720},
};
export { OrganizationView } from "./lazy-organization";

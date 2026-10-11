"use client";
import { AppFrame, type AppProps } from "@/features/appshell";
import type { WorkspaceView } from "./lib/workspace-model";
import { WorkspaceScreen } from "./components/workspace-screen";
export function KnowledgeWorkspaceApp({payload, initialView="vault"}: AppProps & {initialView?: WorkspaceView}) {
  const context = payload && typeof payload === "object" ? payload as {root?:unknown;project?:unknown} : {};
  const root = typeof context.root === "string" ? context.root : undefined;
  const project = typeof context.project === "string" ? context.project : undefined;
  return <AppFrame safeArea={false} className="h-full bg-background" bodyClassName="overflow-hidden"><WorkspaceScreen key={`${root??""}\n${project??""}`} initialView={initialView} root={root} project={project}/></AppFrame>;
}
export default KnowledgeWorkspaceApp;

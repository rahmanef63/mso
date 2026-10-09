"use client";
import { AppFrame, type AppProps } from "@/features/appshell";
import { VaultScreen } from "./components/vault-screen";
export default function AgentVaultApp(_props: AppProps) {
  return <AppFrame safeArea={false} className="h-full bg-background" bodyClassName="overflow-hidden"><VaultScreen /></AppFrame>;
}

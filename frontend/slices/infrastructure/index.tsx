import { Cloud, ServerCog } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export type InfrastructureFeatureId = "dokploy" | "cloudflare";

function descriptor(id: InfrastructureFeatureId): AppDescriptor {
  const isDokploy = id === "dokploy";
  return {
    id,
    title: isDokploy ? "Dokploy" : "Cloudflare",
    icon: isDokploy ? ServerCog : Cloud,
    gradient: isDokploy ? "linear-gradient(160deg,#111827,#2563eb)" : "linear-gradient(160deg,#f59e0b,#ea580c)",
    load: async () => {
      const { InfrastructureProviderApp } = await import("./app");
      return { default: () => <InfrastructureProviderApp provider={id} /> };
    },
    defaultSize: { w: 960, h: 680 },
  };
}

export const dokployApp = descriptor("dokploy");
export const cloudflareApp = descriptor("cloudflare");

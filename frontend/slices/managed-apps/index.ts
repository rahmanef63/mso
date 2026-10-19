import type { AppDescriptor } from "@/features/appshell";
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { MANAGED_APP_META } from "./app-meta";

function managedDescriptor(app: ManagedAppId): AppDescriptor {
  const meta = MANAGED_APP_META[app];
  return {
    id: app,
    title: meta.title,
    icon: meta.icon,
    gradient: meta.gradient,
    prefetch: "never",
    load: async () => {
      const loaded = await import("./app");
      return { default: loaded[meta.loader] };
    },
    defaultSize: { w: 1100, h: 720 },
  };
}

export const hermesApp = managedDescriptor("hermes");
export const openclawApp = managedDescriptor("openclaw");
export const nineRouterApp = managedDescriptor("9router");
export const orcaApp = managedDescriptor("orca");

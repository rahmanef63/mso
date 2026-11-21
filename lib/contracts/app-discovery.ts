import type { ManagedAppId } from "@/lib/managed-apps/types";

export type LocalAppOwnership = "mso-managed" | "detected-local" | "not-found";

export type LocalDetectionSource =
  | "managed-runtime"
  | "docker"
  | "systemd"
  | "port"
  | "directory"
  | "none";

export type LocalRecommendedAction = "open" | "start" | "connect" | "install";

export interface DiscoveredLocalApp {
  id: string;
  name: string;
  description: string;
  managedAppId?: ManagedAppId;
  ownership: LocalAppOwnership;
  running: boolean;
  source: LocalDetectionSource;
  detectedEndpoint?: string;
  detectedPath?: string;
  containerName?: string;
  recommendedAction: LocalRecommendedAction;
  hint: string;
}

export interface LocalDiscoverySnapshot {
  schemaVersion: 1;
  checkedAt: string;
  dockerAvailable: boolean;
  apps: DiscoveredLocalApp[];
}

export type CamoufoxPowerAction = "start" | "stop";
export type CamoufoxStatus = {
  running: boolean;
  enabled?: boolean;
  installed?: boolean;
  viewerReady?: boolean;
  activeState?: string;
  unit?: string;
  detail?: string;
};
export type CamoufoxSession = {
  hasPassword: boolean;
  viewerOrigin: string | null;
  viewerPathPrefix: string | null;
};
export type DesktopContainerItem = {
  id: string;
  name: string;
  state: string;
  status: string;
  labels: { user: string | null; bot: string | null };
  created: string;
  ports: string;
};
export type DesktopContainersResponse = { containers: DesktopContainerItem[] };
export type DesktopLifecycleAction = "start" | "stop" | "restart" | "logs";
export type DesktopLifecycleResult = {
  action: DesktopLifecycleAction;
  container: string;
  state: DesktopContainerItem | null;
  logs?: string[];
};

export const LIFECYCLE_ACTIONS = new Set<DesktopLifecycleAction>(["start", "stop", "restart", "logs"]);

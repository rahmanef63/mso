import type { OsApi } from "@/lib/os-api";

export type ToolGroup = "files" | "system" | "apps" | "skills" | "agent" | "terminal";

export type AppDescriptor = {
  id: string;
  slug?: string;
  title: string;
  defaultSize?: { width: number; height: number };
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type HostEffect = "read" | "mutate";

export type HostToolRuntime = {
  apps: AppDescriptor[];
  openWindow?: (
    id: string,
    title: string,
    size?: { width: number; height: number },
    payload?: { path?: string },
  ) => void;
};

export type HostTool = {
  name: string;
  group: ToolGroup;
  label: string;
  description: string;
  parameters: JsonSchema;
  effect: HostEffect;
  run: (api: OsApi, args: Record<string, unknown>, runtime: HostToolRuntime) => string | Promise<string>;
};

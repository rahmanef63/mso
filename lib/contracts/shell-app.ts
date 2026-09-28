import type { ConnectedAppManifest } from "./connected-app-manifest";
import type { WorkflowEmbed } from "./surface-app";

export type ShellAppDefinition = {
  id: string;
  title: string;
  description: string;
  url: string;
  mode: "embed" | "tab";
};
export type ShellAppView = WorkflowEmbed & { definition: ShellAppDefinition; manifest?: ConnectedAppManifest };
export type ShellAppSnapshot = {
  schemaVersion: 1;
  revision: string;
  configurable: boolean;
  apps: ShellAppView[];
};
export type ShellAppChange =
  | { action: "add" | "update"; app: ShellAppDefinition }
  | { action: "remove"; id: string }
  | { action: "import"; manifest: ConnectedAppManifest; binding: Pick<ShellAppDefinition, "id" | "url" | "mode"> };
export type ShellAppMutation = ShellAppChange & {
  schemaVersion: 1;
  expectedRevision: string;
  confirm: true;
};
export const shellAppId = (id: string) => `external-${id}`;

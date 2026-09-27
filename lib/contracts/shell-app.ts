import type { WorkflowEmbed } from "./surface-app";

export type ShellAppDefinition = {
  id: string;
  title: string;
  description: string;
  url: string;
  mode: "embed" | "tab";
};
export type ShellAppView = WorkflowEmbed & { definition: ShellAppDefinition };
export type ShellAppSnapshot = {
  schemaVersion: 1;
  revision: string;
  configurable: boolean;
  apps: ShellAppView[];
};
export type ShellAppMutation = {
  schemaVersion: 1;
  action: "add" | "update" | "remove";
  expectedRevision: string;
  confirm: true;
  app?: ShellAppDefinition;
  id?: string;
};
export const shellAppId = (id: string) => `external-${id}`;

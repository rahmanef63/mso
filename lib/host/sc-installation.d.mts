export interface ScInstallation { name: string; version: string; root: string; bin: string; mcpEntrypoint: string; }
export function inspectScInstallation(candidate: string): Promise<ScInstallation>;

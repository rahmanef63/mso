import type { ManagedAppDefinition, ManagedAppInstallBackend } from "./types";

export type ManagedAppHostCapabilities = {
  platform: NodeJS.Platform;
  userSystemd: boolean;
  docker: boolean;
};

export type ManagedAppInstallSupport = {
  supported: boolean;
  backend: ManagedAppInstallBackend | null;
  reason: string | null;
};

/** The adapter's actual install backends, evaluated before any download/job. */
export function managedAppInstallSupport(
  definition: ManagedAppDefinition,
  host: ManagedAppHostCapabilities,
): ManagedAppInstallSupport {
  if (host.platform !== "linux") {
    return { supported: false, backend: null, reason: "Managed app installers require a Linux runtime on this host." };
  }
  for (const backend of definition.installBackends) {
    if (backend === "user-systemd" && host.userSystemd) return { supported: true, backend, reason: null };
    if (backend === "docker" && host.docker) return { supported: true, backend, reason: null };
  }
  const required = definition.installBackends.includes("user-systemd")
    ? definition.installBackends.includes("docker") ? "a working user systemd bus or Docker daemon" : "a working user systemd bus"
    : "a working Docker daemon";
  return { supported: false, backend: null, reason: `${definition.name} requires ${required} accessible to the MSO service user.` };
}

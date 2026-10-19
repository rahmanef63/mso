import type { ManagedAppDefinition, ManagedAppInstallBackend } from "./types";

export type ManagedAppHostCapabilities = {
  platform: NodeJS.Platform;
  userSystemd: boolean;
  docker: boolean;
  /** CPU architecture. Only Orca's pinned release is arch-specific today. */
  arch?: string;
  /** True only when a glibc runtime is proven; Orca has no musl build. */
  glibc?: boolean;
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
  // Orca's pinned release is linux-x64-glibc only. Fail closed when the arch is
  // unknown or a musl host, rather than starting an install that cannot run.
  if (definition.id === "orca" && (host.arch !== "x64" || host.glibc !== true)) {
    return {
      supported: false,
      backend: null,
      reason: "Orca requires a Linux x64 glibc host; the pinned release has no other build.",
    };
  }
  for (const backend of definition.installBackends) {
    if (backend === "user-systemd" && host.userSystemd) return { supported: true, backend, reason: null };
    if (backend === "docker" && host.docker) return { supported: true, backend, reason: null };
  }
  if (definition.installBackends.length === 0) {
    return { supported: false, backend: null, reason: `${definition.name} installer is not available yet.` };
  }
  const required = definition.installBackends.includes("user-systemd")
    ? definition.installBackends.includes("docker") ? "a working user systemd bus or Docker daemon" : "a working user systemd bus"
    : "a working Docker daemon";
  return { supported: false, backend: null, reason: `${definition.name} requires ${required} accessible to the MSO service user.` };
}

import "server-only";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { getManagedAppDefinition } from "./catalog";
import { dockerUsable } from "./docker";
import { managedAppInstallSupport } from "./host-compatibility";
import { getManagedApp } from "./manager";
import { managedAppOrigin } from "./origin";
import type { ManagedAppId } from "./types";
import { userBusUnavailable } from "./user-bus";

export type AppDeckCheckStatus = "pass" | "warn" | "fail";

export interface AppDeckPreflightCheck {
  id: string;
  label: string;
  status: AppDeckCheckStatus;
  detail: string;
  fixHint?: string;
}

export interface AppDeckPreflightReport {
  appId: ManagedAppId;
  appName: string;
  installed: boolean;
  ready: boolean;
  summary: string;
  backend: "user-systemd" | "docker" | null;
  checks: AppDeckPreflightCheck[];
  checkedAt: string;
}

const MIN_DISK_BYTES = 512 * 1024 * 1024;
const WARN_DISK_BYTES = 2 * 1024 * 1024 * 1024;

function hostUsesGlibc(): boolean {
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    return typeof report?.header?.glibcVersionRuntime === "string";
  } catch {
    return false;
  }
}

function dashboardPortFor(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function isLoopbackPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (busy: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(600);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function checkDiskSpace(): Promise<AppDeckPreflightCheck> {
  try {
    const stats = await fs.statfs(os.homedir());
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const freeGb = (freeBytes / (1024 ** 3)).toFixed(1);
    if (freeBytes < MIN_DISK_BYTES) {
      return {
        id: "disk",
        label: "Storage space",
        status: "fail",
        detail: `Only ${freeGb} GB free in home directory (at least 0.5 GB required).`,
        fixHint: "Free up disk space or remove old backups before installing.",
      };
    }
    if (freeBytes < WARN_DISK_BYTES) {
      return {
        id: "disk",
        label: "Storage space",
        status: "warn",
        detail: `${freeGb} GB free. Enough to install, though backups may fill space quickly.`,
        fixHint: "Keep at least 2 GB free for smooth updates and automatic backups.",
      };
    }
    return { id: "disk", label: "Storage space", status: "pass", detail: `${freeGb} GB available.` };
  } catch {
    return { id: "disk", label: "Storage space", status: "warn", detail: "Could not read free disk space." };
  }
}

async function checkArtifactLock(appId: ManagedAppId): Promise<AppDeckPreflightCheck> {
  const target = appId === "orca"
    ? path.join(process.cwd(), "scripts", "orca", "constants.mjs")
    : path.join(process.cwd(), "security", "managed-app-artifacts.env");
  const ok = await fs.access(target).then(() => true, () => false);
  return ok
    ? { id: "lock", label: "Verified package lock", status: "pass", detail: "Signed digest lock file is present." }
    : {
        id: "lock",
        label: "Verified package lock",
        status: "fail",
        detail: "Pinned artifact lock file is missing from this MSO install.",
        fixHint: "Update MSO from Settings to restore the verified package lock.",
      };
}

export async function runAppDeckPreflight(appId: ManagedAppId): Promise<AppDeckPreflightReport> {
  const definition = getManagedAppDefinition(appId);
  const view = await getManagedApp(appId);
  const hasDocker = definition.installBackends.includes("docker") && await dockerUsable();
  const support = managedAppInstallSupport(definition, {
    platform: process.platform,
    arch: process.arch,
    glibc: hostUsesGlibc(),
    userSystemd: !userBusUnavailable(),
    docker: hasDocker,
  });

  const checks: AppDeckPreflightCheck[] = [
    support.supported
      ? {
          id: "runtime",
          label: "Host runtime",
          status: "pass",
          detail: support.backend === "docker" ? "Docker engine is ready." : "User service manager (systemd) is ready.",
        }
      : {
          id: "runtime",
          label: "Host runtime",
          status: "fail",
          detail: support.reason ?? "Required runtime is unavailable on this host.",
          fixHint: definition.installBackends.includes("docker")
            ? "Install and start Docker, and ensure the MSO user can access it."
            : "Enable user systemd linger on this Linux host so background apps can run.",
        },
  ];

  checks.push(await checkDiskSpace());
  checks.push(await checkArtifactLock(appId));

  if (appId === "orca") {
    const origin = managedAppOrigin("orca");
    checks.push(
      origin
        ? { id: "origin", label: "App domain route", status: "pass", detail: `Split app origin ready (${origin}).` }
        : {
            id: "origin",
            label: "App domain route",
            status: "fail",
            detail: "Orca needs a dedicated app host template before installation.",
            fixHint: "Set NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE in MSO configuration (for example {id}.your-domain.com).",
          },
    );
  }

  const port = dashboardPortFor(definition.dashboardUrl);
  if (!view.installed && port) {
    const busy = await isLoopbackPortBusy(port);
    checks.push(
      busy
        ? {
            id: "port",
            label: `Local port ${port}`,
            status: "fail",
            detail: `Another program is already using local port ${port}.`,
            fixHint: `Stop the service using port ${port} before installing ${definition.name}.`,
          }
        : { id: "port", label: `Local port ${port}`, status: "pass", detail: `Port ${port} is free on loopback.` },
    );
  }

  const failed = checks.filter((entry) => entry.status === "fail");
  const ready = failed.length === 0 && !view.diagnostic;
  const summary = ready
    ? `${definition.name} is ready for 1-click setup via AppDeck.`
    : view.diagnostic ?? failed[0]?.detail ?? `${definition.name} needs attention before installation.`;

  return {
    appId,
    appName: definition.name,
    installed: view.installed,
    ready,
    summary,
    backend: support.backend,
    checks,
    checkedAt: new Date().toISOString(),
  };
}

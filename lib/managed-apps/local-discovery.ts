import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiscoveredLocalApp, LocalDiscoverySnapshot } from "@/lib/contracts/app-discovery";
import { getManagedAppDefinition, listManagedAppDefinitions } from "./catalog";
import { dockerUsable, runDocker } from "./docker";
import { listManagedApps } from "./manager";
import type { ManagedAppDefinition, ManagedAppId, ManagedAppView } from "./types";

interface DockerRow {
  name: string;
  image: string;
  running: boolean;
  ports: string;
}

const IMAGE_MATCHERS: Partial<Record<ManagedAppId, RegExp>> = {
  n8n: /(?:^|\/)n8n(?::|@|$)/i,
  "9router": /(?:^|\/)9router(?::|@|$)/i,
  hermes: /hermes-agent/i,
  openclaw: /openclaw/i,
};

function displayHomePath(target: string): string {
  const home = os.homedir();
  if (target === home) return "~";
  if (target.startsWith(`${home}${path.sep}`)) return `~/${target.slice(home.length + 1)}`;
  return target;
}

async function listDockerRows(): Promise<{ available: boolean; rows: DockerRow[] }> {
  if (!(await dockerUsable())) return { available: false, rows: [] };
  const result = await runDocker(["ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Ports}}"], 5_000);
  if (result.code !== 0) return { available: true, rows: [] };
  const rows: DockerRow[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name = "", image = "", state = "", ports = ""] = trimmed.split("\t");
    if (name) rows.push({ name, image, running: state.toLowerCase() === "running", ports });
  }
  return { available: true, rows };
}

function parseLocalPortFromDocker(ports: string): number | null {
  const match = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)->/.exec(ports);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

async function probeLoopback(url: string, healthPath = "/"): Promise<boolean> {
  try {
    const target = new URL(healthPath, url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) return false;
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(1_200),
    });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function stateDirExists(definition: ManagedAppDefinition): Promise<string | null> {
  const target = definition.homeDir?.trim() || path.join(os.homedir(), definition.stateDirName);
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() ? displayHomePath(target) : null;
  } catch {
    return null;
  }
}

function findForeignContainer(definition: ManagedAppDefinition, rows: DockerRow[]): DockerRow | null {
  const owned = new Set(definition.containerNames.map((n) => n.toLowerCase()));
  const matcher = IMAGE_MATCHERS[definition.id];
  return (
    rows.find((row) => {
      const lower = row.name.toLowerCase();
      if (owned.has(lower)) return false;
      if (matcher && matcher.test(row.image)) return true;
      return lower.includes(definition.id);
    }) ?? null
  );
}

async function inspectOne(
  view: ManagedAppView,
  rows: DockerRow[],
): Promise<DiscoveredLocalApp> {
  const definition = getManagedAppDefinition(view.id);
  const detectedPath = await stateDirExists(definition);

  if (view.installed) {
    const running = view.state === "running" || view.state === "starting";
    return {
      id: view.id,
      name: view.name,
      description: view.description,
      managedAppId: view.id,
      ownership: "mso-managed",
      running,
      source: "managed-runtime",
      detectedEndpoint: definition.dashboardUrl,
      ...(detectedPath ? { detectedPath } : {}),
      recommendedAction: running ? "open" : "start",
      hint: running
        ? `Managed by MSO and running at ${definition.dashboardUrl}. Open directly or manage updates and backups inside its window.`
        : "Installed and managed by MSO, currently stopped. Start it with one click.",
    };
  }

  const foreign = findForeignContainer(definition, rows);
  if (foreign) {
    const hostPort = parseLocalPortFromDocker(foreign.ports);
    const endpoint = hostPort ? `http://127.0.0.1:${hostPort}` : definition.dashboardUrl;
    return {
      id: view.id,
      name: view.name,
      description: view.description,
      managedAppId: view.id,
      ownership: "detected-local",
      running: foreign.running,
      source: "docker",
      detectedEndpoint: endpoint,
      ...(detectedPath ? { detectedPath } : {}),
      containerName: foreign.name,
      recommendedAction: "connect",
      hint: `Detected existing Docker container "${foreign.name}" outside MSO. Connect it safely without letting MSO overwrite or uninstall it.`,
    };
  }

  const portAlive = await probeLoopback(definition.dashboardUrl, definition.healthPath ?? "/");
  if (portAlive) {
    return {
      id: view.id,
      name: view.name,
      description: view.description,
      managedAppId: view.id,
      ownership: "detected-local",
      running: true,
      source: "port",
      detectedEndpoint: definition.dashboardUrl,
      ...(detectedPath ? { detectedPath } : {}),
      recommendedAction: "connect",
      hint: `Detected a running ${view.name} service at ${definition.dashboardUrl}. Connect it or inspect its setup inside the ${view.name} window.`,
    };
  }

  if (detectedPath) {
    return {
      id: view.id,
      name: view.name,
      description: view.description,
      managedAppId: view.id,
      ownership: "detected-local",
      running: false,
      source: "directory",
      detectedEndpoint: definition.dashboardUrl,
      detectedPath,
      recommendedAction: "install",
      hint: `Found existing data folder ${detectedPath} on this computer. Installing via MSO keeps your existing data intact.`,
    };
  }

  return {
    id: view.id,
    name: view.name,
    description: view.description,
    managedAppId: view.id,
    ownership: "not-found",
    running: false,
    source: "none",
    recommendedAction: "install",
    hint: `Not installed on this computer yet. Install with one click or connect a remote ${view.name} server.`,
  };
}

export async function discoverLocalApps(): Promise<LocalDiscoverySnapshot> {
  if (process.env.MSO_MANAGED_APPS_ISOLATE === "1") {
    return {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      dockerAvailable: false,
      apps: listManagedAppDefinitions().map((def) => ({
        id: def.id, name: def.name, description: def.description, managedAppId: def.id,
        ownership: "not-found", running: false, source: "none", recommendedAction: "install",
        hint: `Not installed on this computer yet. Install with one click or connect a remote ${def.name} server.`,
      })),
    };
  }
  const [managedViews, docker] = await Promise.all([listManagedApps(), listDockerRows()]);
  const byId = new Map(managedViews.map((v) => [v.id, v]));
  const apps: DiscoveredLocalApp[] = [];
  for (const def of listManagedAppDefinitions()) {
    const view = byId.get(def.id);
    if (view) apps.push(await inspectOne(view, docker.rows));
  }
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    dockerAvailable: docker.available,
    apps,
  };
}

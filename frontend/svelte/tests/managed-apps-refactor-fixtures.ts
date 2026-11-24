// Fixtures for managed-apps-refactor.test.ts. Kept beside the test so the
// test file stays inside the repository's 220-line physical line ratchet.
import { resolve } from "node:path";
import type { ManagedAppItem } from "../src/lib/managed-apps/managed-apps-api.ts";

export const SLICE = resolve(import.meta.dirname, "../src/lib/managed-apps");
export const signal = new AbortController().signal;

export const job = {
  id: "a".repeat(24), applicationId: "hermes", kind: "update", argv: ["hermes", "update"],
  status: "succeeded", startedAt: "2026-11-21T19:00:00.000Z", endedAt: "2026-11-21T19:01:00.000Z",
  exitCode: 0, error: null, logOffset: 12, updatedAt: "2026-11-21T19:01:00.000Z",
};

export const app = (over: Partial<ManagedAppItem> = {}): ManagedAppItem => ({
  id: "hermes", name: "Hermes", description: "Agent runtime", installed: true, installationType: "systemd",
  state: "running", healthy: true, version: "1.4.2", dashboardAvailable: true,
  publicDashboardUrl: "https://hermes.example.com", supportedActions: ["start", "stop", "restart", "backup"],
  diagnostic: null, ...over,
});

export const backupsPayload = { backups: [{
  id: "20261121T190000Z", applicationId: "hermes", createdAt: "2026-11-21T19:00:00.000Z",
  source: "/home/a/.hermes", reason: "manual", files: 3, bytes: 4096,
}] };

export const preflightPayload = {
  appId: "hermes", appName: "Hermes", installed: true, ready: true, summary: "Ready",
  backend: "user-systemd", checkedAt: "2026-11-21T19:00:00.000Z",
  checks: [{ id: "disk", label: "Storage", status: "pass", detail: "24 GB free" }],
};

export const discoveryPayload = {
  checkedAt: "2026-11-21T19:00:00.000Z", dockerAvailable: false,
  apps: [{ id: "x", name: "X", description: "", ownership: "detected-local", running: false, source: "port",
    recommendedAction: "connect", hint: "Found on port 8080" }],
};

export const tunnelsPayload = { sshAvailable: true, tunnels: [{
  id: "t1", appId: "n8n", title: "n8n", sshUser: "u", sshHost: "h", sshPort: 22, remotePort: 5678,
  localPort: 15678, active: true, pid: 42, localUrl: "http://127.0.0.1:15678", error: null,
}] };

export const updateStatusPayload = {
  currentVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, detail: null,
  channel: { value: "main", kind: "branch", available: [], switchable: false, reason: null },
  installKind: "git", checkedAt: "2026-11-21T19:00:00.000Z", error: null,
};

export const updatePackagePayload = {
  currentVersion: "1.4.2", latestVersion: null, updateAvailable: false, detail: null,
  channel: { value: "main", kind: "branch", available: [], switchable: false, reason: null },
  installKind: "git", checkedAt: "2026-11-21T19:00:00.000Z", error: null,
};

export function createDetailFetcher(seen: string[]): { fetcher: typeof fetch; actionPosts: () => number } {
  let posts = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST") {
      posts++;
      return Response.json({ app: app() });
    }
    if (url.endsWith("/preflight")) return Response.json({ ...preflightPayload, checks: [] });
    if (url.endsWith("/update")) return Response.json(updatePackagePayload);
    if (url.endsWith("/jobs")) return Response.json({ jobs: [job] });
    if (url.endsWith("/logs")) return Response.json({ available: true, entries: ["ok"] });
    if (url.endsWith("/backups")) return Response.json({ backups: [] });
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
  return { fetcher, actionPosts: () => posts };
}

export const overviewFetcher: typeof fetch = async (input) => {
  const url = String(input);
  if (url.endsWith("/managed-apps")) return Response.json({ apps: [app()] });
  if (url.endsWith("/discover")) {
    return Response.json({ checkedAt: "2026-11-21T19:00:00.000Z", dockerAvailable: false, apps: [] });
  }
  return Response.json({ error: "owner_required" }, { status: 403 });
};

export const packageUpdates = [
  { name: "openssl", current: "3.0.13", candidate: "3.0.13.4", architecture: "amd64" },
  { name: "curl", current: "8.5.0", candidate: "8.5.0" },
  { name: "nodejs", candidate: "20.1.0", architecture: "arm64" },
];

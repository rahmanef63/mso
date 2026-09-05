import type { InfraProviderValues } from "./types";
import { safeProviderFetch } from "@/lib/host/ssrf";
import { readInfraProvider } from "./store";
import { obj, request, TIMEOUT_MS } from "./http";

function dokployFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestInput = new Request(input, { ...init, redirect: "error" });
  const host = new URL(requestInput.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // Loopback is an explicit same-host Dokploy case. All remote endpoints use the
  // DNS-pinned safe transport so DNS rebinding/private metadata routes are refused.
  if (["127.0.0.1", "localhost", "::1"].includes(host)) return fetch(requestInput);
  return safeProviderFetch(requestInput);
}

async function call(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  const values = await readInfraProvider("dokploy");
  if (!values.apiUrl || !values.apiKey) throw new Error("Dokploy is not configured; run `mso provider set dokploy`");
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(`${values.apiUrl}${endpoint}`, {
        method,
        headers: { "x-api-key": values.apiKey, accept: "application/json", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, TIMEOUT_MS, dokployFetch);
      if (res.ok) return res.body;
      if (res.status !== 429 && res.status < 500) throw new Error(`Dokploy HTTP ${res.status}: ${res.text.slice(0, 300)}`);
      last = new Error(`Dokploy HTTP ${res.status}`);
    } catch (error) {
      last = error as Error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw last ?? new Error("Dokploy request failed");
}

export async function doctorDokploy(candidate?: InfraProviderValues): Promise<string | null> {
  const values = candidate ?? await readInfraProvider("dokploy");
  if (!values.apiUrl || !values.apiKey) return null;
  const res = await request(`${values.apiUrl}/project.all`, {
    headers: { "x-api-key": values.apiKey, accept: "application/json" },
  }, TIMEOUT_MS, dokployFetch);
  if (!res.ok) throw new Error(`Dokploy HTTP ${res.status}`);
  return `reachable; ${Array.isArray(res.body) ? res.body.length : 0} project(s)`;
}

export async function listDokployProjects(): Promise<Array<{ projectId: string; name: string }>> {
  const rows = await call("/project.all");
  if (!Array.isArray(rows)) throw new Error("Dokploy project.all returned an unexpected response");
  return rows
    .map((row) => obj(row))
    .map((row) => ({ projectId: String(row.projectId ?? row.id ?? ""), name: String(row.name ?? "") }))
    .filter((row) => row.projectId && row.name);
}

export async function ensureDokployProject(name: string): Promise<{ projectId: string; name: string; created: boolean }> {
  const clean = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(clean)) throw new Error("invalid Dokploy project name");
  const existing = (await listDokployProjects()).find((row) => row.name === clean);
  if (existing) return { ...existing, created: false };
  await call("/project.create", "POST", { name: clean });
  const created = (await listDokployProjects()).find((row) => row.name === clean);
  if (!created) throw new Error("Dokploy project create returned success but the project is still absent");
  return { ...created, created: true };
}

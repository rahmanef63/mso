import type { OrganizationChart, OrganizationSeatRuntime } from "@/lib/contracts/organization";
export type OrganizationPayload = { chart: OrganizationChart; runtime: OrganizationSeatRuntime[] };
async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> { const response = await fetch(input, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `request failed (${response.status})`); return body as T; }
export const getOrganization = () => json<OrganizationPayload>("/api/v1/organization");
export const mutateOrganization = (body: Record<string, unknown>) => json<OrganizationPayload>("/api/v1/organization", { method: "POST", body: JSON.stringify(body) });

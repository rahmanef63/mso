import { safeProviderFetch } from "@/lib/host/ssrf";
import { request, TIMEOUT_MS } from "./http";
import { resolveConvexDeploymentOrigin } from "./convex-cloud-core";

/**
 * Convex has ONE provider and two credential shapes. The doctor therefore picks
 * its probe from the stored SHAPE, never from a provider id:
 *  - `apiUrl` present ⇒ self-hosted deployment (admin key at /api/check_admin_key)
 *  - otherwise ⇒ Convex Cloud (deployment key + name, team token or legacy personal token)
 *
 * "Deployment unreachable" and "admin key rejected" are deliberately different
 * messages: an operator fixes a different thing in each case. `Convex HTTP <status>`
 * is preserved so the existing connection-health classifier still reads `invalid`.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const present = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** A bounded SSRF-safe transport for an explicitly configured Convex endpoint. */
function convexFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestInput = new Request(input, { ...init, redirect: "error" });
  const host = new URL(requestInput.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return fetch(requestInput);
  return safeProviderFetch(requestInput);
}

export function selfHostedAdminKeyCheckUrl(rawUrl: string): string {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error("Convex invalid deployment URL"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("Convex invalid deployment URL");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(host)))
    throw new Error("Convex invalid deployment URL");
  url.pathname = "/api/check_admin_key";
  return url.toString();
}

function cloudDeploymentInfoUrl(origin: string): string {
  return `${origin}/api/v1/deployment_info`;
}

async function checked(provider: string, url: string, headers: HeadersInit, fetchImpl?: typeof fetch) {
  let response;
  try { response = await request(url, { headers }, TIMEOUT_MS, fetchImpl); }
  catch { throw new Error(`${provider} request failed`); }
  if (!response.ok) throw new Error(`${provider} HTTP ${response.status}`);
  return response;
}

async function checkedSelfHosted(url: string, headers: HeadersInit) {
  let response;
  try { response = await request(url, { headers }, TIMEOUT_MS, convexFetch); }
  catch { throw new Error("Convex deployment unreachable: no HTTP response (DNS, TLS or connection failed)"); }
  if (response.status === 401 || response.status === 403) throw new Error(`Convex HTTP ${response.status}; deployment reachable, admin key rejected`);
  if (!response.ok) throw new Error(`Convex HTTP ${response.status}`);
  return response;
}

export async function doctorConvex(values: Record<string, string>): Promise<string | null> {
  // Self-hosted first: a stored deployment URL is the unambiguous shape marker,
  // and it is also the inference a pre-collapse row relies on.
  if (values.apiUrl) {
    if (!present(values.adminKey)) return null;
    await checkedSelfHosted(selfHostedAdminKeyCheckUrl(values.apiUrl), { authorization: `Convex ${values.adminKey}`, accept: "application/json" });
    return "authenticated; deployment access verified";
  }
  if (present(values.deployKey) || present(values.deploymentName)) {
    if (!present(values.deployKey) || !present(values.deploymentName)) return null;
    // A cloud deployment does not live at `<name>.convex.cloud` unless it was
    // created in the default region. Resolve the real origin from the key first;
    // a hardcoded host made a valid key look like a 404.
    const origin = await resolveConvexDeploymentOrigin(values.deploymentName, values.deployKey, fetch);
    await checked("Convex Cloud", cloudDeploymentInfoUrl(origin), { authorization: `Convex ${values.deployKey}`, accept: "application/json" });
    return "authenticated; deployment access verified";
  }
  // Team access tokens must be checked through token_details, never the
  // PAT-only list_personal_access_tokens endpoint (which may return 403).
  if (present(values.teamToken)) {
    const response = await checked("Convex Cloud", "https://api.convex.dev/v1/token_details", { authorization: "Bearer " + values.teamToken, accept: "application/json" });
    const details = response.body;
    if (!details || typeof details !== "object" || Array.isArray(details) || (details as Record<string, unknown>).type !== "teamToken")
      throw new Error("Convex Cloud token_details did not identify a team access token");
    return "team access token authenticated; team identity verified";
  }
  // The official OpenAPI explicitly declares PAT authentication here. Only
  // authentication status escapes; the token inventory is discarded.
  if (present(values.personalToken)) {
    await checked("Convex Cloud", "https://api.convex.dev/v1/list_personal_access_tokens?limit=1", { authorization: `Bearer ${values.personalToken}`, accept: "application/json" });
    return "personal access token authenticated; account read access verified";
  }
  return null;
}

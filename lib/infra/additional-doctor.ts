import { safeProviderFetch } from "@/lib/host/ssrf";
import { obj, request, TIMEOUT_MS } from "./http";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A bounded SSRF-safe transport for an explicitly configured Convex endpoint. */
function convexFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestInput = new Request(input, { ...init, redirect: "error" });
  const host = new URL(requestInput.url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return fetch(requestInput);
  return safeProviderFetch(requestInput);
}

function selfHostedDeploymentInfoUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Convex invalid deployment URL");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("Convex invalid deployment URL");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(host))) {
    throw new Error("Convex invalid deployment URL");
  }
  url.pathname = "/api/v1/deployment_info";
  return url.toString();
}

function cloudDeploymentInfoUrl(name: string): string {
  const clean = name.trim().toLowerCase();
  // Deployment names are hostname labels, not URLs. This keeps the request fixed
  // to Convex Cloud and avoids accepting an attacker-controlled authority.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(clean)) throw new Error("Convex Cloud invalid deployment name");
  return `https://${clean}.convex.cloud/api/v1/deployment_info`;
}

async function checked(provider: string, url: string, headers: HeadersInit, fetchImpl?: typeof fetch): Promise<Awaited<ReturnType<typeof request>>> {
  let response;
  try { response = await request(url, { headers }, TIMEOUT_MS, fetchImpl); }
  catch { throw new Error(`${provider} request failed`); }
  if (!response.ok) throw new Error(`${provider} HTTP ${response.status}`);
  return response;
}

function countRows(body: unknown): number {
  if (Array.isArray(body)) return body.length;
  const value = obj(body);
  for (const key of ["data", "domains", "projects"]) if (Array.isArray(value[key])) return value[key].length;
  return 0;
}

/**
 * Verifies additional provider credentials without logging secrets or exposing
 * provider response payloads. A non-null result proves authentication at the
 * checked endpoint, not every permission needed by a later operation.
 */
export async function doctorAdditionalProvider(id: string, values: Record<string, string>): Promise<string | null> {
  switch (id) {
    case "github": {
      if (!present(values.apiKey)) return null;
      await checked("GitHub", "https://api.github.com/user", {
        authorization: `Bearer ${values.apiKey}`,
        accept: "application/vnd.github+json",
        "user-agent": "MSO-integration-doctor",
        "x-github-api-version": "2022-11-28",
      });
      // request intentionally does not return response headers. Therefore this
      // doctor never claims repo scope: authentication is all it can prove here.
      return "authenticated; repository scope not verified";
    }
    case "vercel": {
      if (!present(values.apiKey)) return null;
      await checked("Vercel", "https://api.vercel.com/v2/user", { authorization: `Bearer ${values.apiKey}`, accept: "application/json" });
      return "authenticated; account access verified";
    }
    case "resend": {
      if (!present(values.apiKey)) return null;
      const response = await checked("Resend", "https://api.resend.com/domains", { authorization: `Bearer ${values.apiKey}`, accept: "application/json" });
      return `authenticated; ${countRows(response.body)} accessible domain(s)`;
    }
    case "stripe": {
      if (!present(values.apiKey)) return null;
      await checked("Stripe", "https://api.stripe.com/v1/account", { authorization: `Bearer ${values.apiKey}`, accept: "application/json" });
      return "authenticated; account access verified";
    }
    case "clerk": {
      if (!present(values.apiKey)) return null;
      await checked("Clerk", "https://api.clerk.com/v1/users?limit=1", { authorization: `Bearer ${values.apiKey}`, accept: "application/json" });
      return "authenticated; Backend API access verified";
    }
    case "supabase": {
      if (!present(values.managementToken)) return null;
      const response = await checked("Supabase", "https://api.supabase.com/v1/projects", { authorization: `Bearer ${values.managementToken}`, accept: "application/json" });
      return `authenticated; ${countRows(response.body)} accessible project(s)`;
    }
    case "convex-cloud": {
      const deployKey = values.deployKey;
      const deploymentName = values.deploymentName;
      if (present(deployKey) || present(deploymentName)) {
        if (!present(deployKey) || !present(deploymentName)) return null;
        await checked("Convex Cloud", cloudDeploymentInfoUrl(deploymentName), { authorization: `Convex ${deployKey}`, accept: "application/json" });
        return "authenticated; deployment access verified";
      }
      // The official OpenAPI explicitly declares PAT authentication here.
      // Discard token inventory immediately; only authentication status escapes.
      if (present(values.personalToken)) {
        await checked("Convex Cloud", "https://api.convex.dev/v1/list_personal_access_tokens?limit=1", { authorization: `Bearer ${values.personalToken}`, accept: "application/json" });
        return "personal access token authenticated; account read access verified";
      }
      return null;
    }
    case "convex": {
      if (!present(values.apiUrl) || !present(values.adminKey)) return null;
      await checked("Convex", selfHostedDeploymentInfoUrl(values.apiUrl), { authorization: `Convex ${values.adminKey}`, accept: "application/json" }, convexFetch);
      return "authenticated; deployment access verified";
    }
    default:
      throw new Error("unknown additional provider");
  }
}

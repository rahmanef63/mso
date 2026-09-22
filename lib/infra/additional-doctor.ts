import { listMcpServerTools } from "@/lib/host/project-mcp-client";
import { normalizeMcpEndpoint, parseMcpToolAllowlist } from "./mcp-policy";
import { safeProviderFetch } from "@/lib/host/ssrf";
import { obj, request, TIMEOUT_MS } from "./http";
import { doctorDoku } from "./doku-doctor";

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

function selfHostedAdminKeyCheckUrl(rawUrl: string): string {
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
  url.pathname = "/api/check_admin_key";
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
    case "mcp": {
      if (!present(values.endpoint) || !present(values.accessToken)) return null;
      const url = normalizeMcpEndpoint(values.endpoint);
      let tools;
      try { tools = await listMcpServerTools({ name: "connection-check", transport: "http", url, headers: { Authorization: "Bearer " + values.accessToken }, oauthConfigured: false }); }
      catch { throw new Error("MCP discovery failed; check endpoint, token expiry and scope"); }
      const allowed = parseMcpToolAllowlist(values.allowedTools);
      if (allowed?.some((name) => !tools.some((tool) => tool.name === name))) throw new Error("MCP allowlist includes a tool unavailable to this token");
      return `MCP discovery verified; ${tools.length} advertised tool(s). Identity and resource access remain downstream-token controlled.`;
    }
    case "openai-app": {
      if (!present(values.appId)) return null;
      if (!/^asdk_app_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(values.appId)) throw new Error("OpenAI registered App ID format is invalid");
      return "private registered-app binding configured; format verified locally; ChatGPT remains authoritative for registration/review status";
    }
    case "github": {
      if (!present(values.apiKey)) return null;
      const response = await checked("GitHub", "https://api.github.com/user", {
        authorization: `Bearer ${values.apiKey}`,
        accept: "application/vnd.github+json",
        "user-agent": "MSO-integration-doctor",
        "x-github-api-version": "2022-11-28",
      });
      // request intentionally does not return response headers. Therefore this
      // doctor never claims repo scope: authentication is all it can prove here.
      const login = obj(response.body).login;
      const account = typeof login === "string" && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(login) && login !== values.apiKey
        ? ` as ${login}` : " (account identity unavailable)";
      return `authenticated${account}; repository scope not verified`;
    }
    case "vercel": {
      if (!present(values.apiKey)) return null;
      await checked("Vercel", "https://api.vercel.com/v2/user", { authorization: `Bearer ${values.apiKey}`, accept: "application/json" });
      return "authenticated; account access verified";
    }
    case "resend": {
      if (!present(values.apiKey)) return null;
      let response;
      try {
        response = await request(
          "https://api.resend.com/domains",
          { headers: { authorization: `Bearer ${values.apiKey}`, accept: "application/json" } },
          TIMEOUT_MS,
        );
      } catch {
        throw new Error("Resend request failed");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("Resend Domains API access unavailable; sending capability not verified");
      }
      if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
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
    case "telegram": {
      if (!present(values.botToken)) return null;
      if (!/^\\d{5,16}:[A-Za-z0-9_-]{20,}$/.test(values.botToken)) throw new Error("Telegram bot token format is invalid");
      const response = await checked("Telegram", "https://api.telegram.org/bot" + values.botToken + "/getMe", { accept: "application/json" });
      const root = obj(response.body);
      const result = obj(root.result);
      if (root.ok !== true || (typeof result.id !== "number" && typeof result.id !== "string")) throw new Error("Telegram bot identity unavailable");
      const username = typeof result.username === "string" && /^[A-Za-z0-9_]{3,64}$/.test(result.username) ? " @" + result.username : "";
      return "authenticated; bot identity verified" + username;
    }
    case "discord": {
      if (!present(values.botToken)) return null;
      const response = await checked("Discord", "https://discord.com/api/v10/users/@me", {
        authorization: "Bot " + values.botToken,
        accept: "application/json",
        "user-agent": "MSO-integration-doctor",
      });
      const body = obj(response.body);
      if (typeof body.id !== "string") throw new Error("Discord bot identity unavailable");
      const username = typeof body.username === "string" && body.username.length <= 80 ? " as " + body.username : "";
      return "authenticated; bot identity verified" + username;
    }
    case "doku":
      return doctorDoku(values);
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
      await checked("Convex", selfHostedAdminKeyCheckUrl(values.apiUrl), { authorization: `Convex ${values.adminKey}`, accept: "application/json" }, convexFetch);
      return "authenticated; deployment access verified";
    }
    default:
      throw new Error("unknown additional provider");
  }
}

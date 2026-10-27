import { listMcpServerTools } from "@/lib/host/project-mcp-client";
import { normalizeMcpEndpoint, parseMcpToolAllowlist } from "./mcp-policy";
import { obj, request, TIMEOUT_MS } from "./http";
import { canonicalProviderId } from "./catalog";
import { doctorConvex } from "./convex-doctor";
import { doctorDoku } from "./doku-doctor";

const present = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

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
  // `convex-cloud` is the pre-collapse id; it resolves to the one Convex doctor.
  const provider = canonicalProviderId(id);
  switch (provider) {
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
      if (!/^\d{5,16}:[A-Za-z0-9_-]{20,}$/.test(values.botToken)) throw new Error("Telegram bot token format is invalid");
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
    case "linear": {
      if (!present(values.apiKey)) return null;
      // Linear personal API keys go in Authorization verbatim (no "Bearer"), and
      // the viewer query proves the key belongs to a real account. The endpoint
      // is fixed so an operator-supplied URL can never redirect credentials.
      let response;
      try {
        response = await request("https://api.linear.app/graphql", {
          method: "POST",
          headers: { authorization: values.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: "query { viewer { id name } }" }),
        });
      } catch { throw new Error("Linear request failed"); }
      if (response.status === 401 || response.status === 403) throw new Error("Linear rejected this API key");
      if (!response.ok) throw new Error(`Linear HTTP ${response.status}`);
      const viewer = obj(obj(response.body).data)?.viewer;
      const name = obj(viewer).name;
      const label = typeof name === "string" && name.length > 0 && name.length <= 120 && !name.includes(values.apiKey) ? " as " + name : "";
      return "authenticated; viewer verified" + label;
    }
    case "doku":
      return doctorDoku(values);
    case "convex": {
      // One provider, two shapes. Read the kind from the values, not from the id.
      return doctorConvex(values);
    }
    default:
      throw new Error("unknown additional provider");
  }
}

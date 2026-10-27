type AdditionalField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  description: string;
  links?: readonly { label: string; url: string }[];
};

type AdditionalProvider = {
  id: string;
  title: string;
  description: string;
  feature: false;
  fields: readonly AdditionalField[];
};

/**
 * Additional native service credentials. The main registry owns all definitions.
 */
export const ADDITIONAL_PROVIDERS = {
  mcp: {
    id: "mcp", title: "Project MCP", feature: false,
    description: "Connect a modular MCP server through MSO using a named, endpoint-bound bearer credential.",
    fields: [
      { key: "endpoint", label: "MCP endpoint", secret: false, required: true, description: "Exact public HTTPS MCP URL. Must match the project's declared endpoint." },
      { key: "accessToken", label: "MCP access token", secret: true, required: true, description: "A token issued by this MCP server to the intended user or assistant. Never use the MSO connector token." },
      { key: "principalLabel", label: "Account / assistant label", secret: false, required: false, description: "Operator reminder only; the downstream token determines real identity and permissions." },
      { key: "allowedTools", label: "Allowed tools", secret: false, required: false, description: "Optional exact comma-separated MCP tool names. Blank permits all tools allowed by the downstream token." },
    ],
  },
  github: {
    id: "github",
    title: "GitHub",
    description: "Connect GitHub through OAuth where available; keep personal access tokens as an explicit manual fallback.",
    feature: false,
    fields: [{ key: "owner", label: "Repository owner", secret: false, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "apiKey", label: "Personal access token (manual fallback)", secret: true, required: true, description: "A GitHub personal access token used only for an explicitly selected direct connection. Prefer a fine-grained token with expiry and the minimum repository access; classic tokens remain supported only when required by the intended operation." }],
  },
  vercel: {
    id: "vercel",
    title: "Vercel",
    description: "Verify a Vercel API token for the selected account.",
    feature: false,
    fields: [{ key: "teamId", label: "Team ID", secret: false, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "apiKey", label: "API token", secret: true, required: true, description: "A Vercel API token. Access is limited by the token owner and any team permissions." }],
  },
  convex: {
    id: "convex",
    title: "Convex",
    description: "One Convex provider for both deployment kinds: Convex Cloud (personal token or deployment key) and self-hosted (deployment URL + admin key).",
    feature: false,
    fields: [
      // Non-secret routing fact, never a credential. Legacy rows omit it and are
      // inferred from apiUrl at read time (catalog.convexDeploymentKind).
      { key: "deploymentKind", label: "Deployment kind", secret: false, required: false, placeholder: "cloud", description: "cloud or self-hosted. Optional and non-secret: it is inferred as self-hosted when a deployment URL is stored, cloud otherwise." },
      { key: "personalToken", label: "Personal access token", secret: true, required: false, description: "Convex Cloud personal access token. Validated through the PAT-authenticated read-only account endpoint." },
      { key: "deployKey", label: "Deployment key", secret: true, required: false, description: "Convex deployment key used with the deployment name below." },
      { key: "deploymentName", label: "Deployment name", secret: false, required: false, description: "Convex deployment hostname prefix. Required together with a deployment key; method-specific requirements are enforced by the UI." },
      { key: "apiUrl", label: "Self-hosted deployment URL", secret: false, required: false, description: "HTTPS deployment URL; HTTP is allowed only for a loopback deployment on this VPS." },
      { key: "adminKey", label: "Self-hosted admin key", secret: true, required: false, description: "Convex admin key for this deployment." },
    ],
  },
  resend: {
    id: "resend",
    title: "Resend",
    description: "Verify a Resend API key and inspect accessible sending domains.",
    feature: false,
    fields: [{ key: "fromDomain", label: "Sending domain", secret: false, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "apiKey", label: "API key", secret: true, required: true, description: "A Resend API key. Domain access and sending permissions depend on the key's scope." }],
  },
  stripe: {
    id: "stripe",
    title: "Stripe",
    description: "Verify a Stripe secret key for account API access.",
    feature: false,
    fields: [{ key: "publishableKey", label: "Publishable key", secret: false, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "webhookSecret", label: "Webhook signing secret", secret: true, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "apiKey", label: "Secret key", secret: true, required: true, description: "A Stripe secret key for the intended account and mode." }],
  },
  clerk: {
    id: "clerk",
    title: "Clerk",
    description: "Verify a Clerk secret key for Backend API access.",
    feature: false,
    fields: [{ key: "publishableKey", label: "Publishable key", secret: false, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "frontendUrl", label: "Frontend API URL", secret: false, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "apiKey", label: "Secret key", secret: true, required: true, description: "A Clerk secret key. Access remains subject to the associated Clerk instance." }],
  },
  supabase: {
    id: "supabase",
    title: "Supabase",
    description: "Verify a Supabase management access token and list accessible projects.",
    feature: false,
    fields: [{ key: "organizationId", label: "Organization ID", secret: false, required: false, description: "Optional connection-specific configuration; retained during JSON transfer." }, { key: "managementToken", label: "Management access token", secret: true, required: true, description: "A Supabase personal access token for the Management API; it is distinct from project API keys." }],
  },
  telegram: {
    id: "telegram",
    title: "Telegram",
    description: "Connect a Telegram bot for MSO Channels without storing bot credentials in channel configuration.",
    feature: false,
    fields: [
      { key: "botToken", label: "Bot token", secret: true, required: true, description: "Telegram Bot API token created by BotFather. Kept only in MSO Integrations." },
      { key: "webhookSecret", label: "Webhook secret", secret: true, required: false, description: "Optional 1–256 character secret used to validate X-Telegram-Bot-Api-Secret-Token on inbound webhooks." },
    ],
  },
  discord: {
    id: "discord",
    title: "Discord",
    description: "Connect a Discord bot/application for MSO Channels with REST sending and signed Interactions.",
    feature: false,
    fields: [
      { key: "botToken", label: "Bot token", secret: true, required: true, description: "Discord bot token. Kept only in MSO Integrations." },
      { key: "applicationId", label: "Application ID", secret: false, required: false, description: "Discord application snowflake used to bind signed interaction payloads to this application." },
      { key: "publicKey", label: "Interactions public key", secret: false, required: false, description: "64-character Ed25519 public key from the Discord Developer Portal for interaction signature verification." },
    ],
  },
  doku: { id:"doku", title:"DOKU", description:"Verify DOKU Payment REST or DOKU MCP merchant credentials without copying secrets into project configuration.", feature:false, fields:[
    {
      key:"paymentClientId",label:"Payment Client ID",secret:true,required:false,
      placeholder:"MCH-0001-xxxxxxxxxxxxxxx",
      description:"Client ID from DOKU Back Office for the same environment selected below. DOKU documents MCH-… as a common Non-SNAP merchant Client-Id shape.",
      links:[
        {label:"Sandbox API Keys",url:"https://sandbox.doku.com/bo/developer/api-keys"},
        {label:"Production API Keys",url:"https://dashboard.doku.com/bo/developer/api-keys"},
      ],
    },
    {
      key:"paymentSecretKey",label:"Payment Secret Key",secret:true,required:false,
      placeholder:"SK-EXAMPLE-DO-NOT-USE",
      description:"Secret Key from the same DOKU Back Office/environment as the Client ID. Used only for HMAC signing; this is not the MCP API Key.",
      links:[
        {label:"Sandbox API Keys",url:"https://sandbox.doku.com/bo/developer/api-keys"},
        {label:"Production API Keys",url:"https://dashboard.doku.com/bo/developer/api-keys"},
      ],
    },
    {
      key:"paymentEnvironment",label:"Payment Environment",secret:false,required:false,
      placeholder:"sandbox",
      description:"You do not copy this from a credential field. Enter sandbox when using Sandbox Client ID + Secret Key (testing), or production when using Production credentials (real payments).",
      links:[
        {label:"Environment guide",url:"https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration"},
        {label:"Sandbox signup",url:"https://sandbox.doku.com/bo/sandbox-registration"},
      ],
    },
    {
      key:"mcpClientId",label:"MCP Client ID",secret:true,required:false,
      placeholder:"BRN-EXAMPLE-000000000000",
      description:"DOKU-issued Client ID for MCP access in the selected environment.",
      links:[{label:"DOKU MCP guide",url:"https://developers.doku.com/accept-payments/doku-mcp-server"}],
    },
    {
      key:"mcpApiKey",label:"MCP API Key",secret:true,required:false,
      placeholder:"DOKU-MCP-API-KEY-EXAMPLE",
      description:"DOKU-issued MCP API Key. It is distinct from the REST payment HMAC Secret Key.",
      links:[{label:"DOKU MCP guide",url:"https://developers.doku.com/accept-payments/doku-mcp-server"}],
    },
    {
      key:"environment",label:"MCP Environment",secret:false,required:false,
      placeholder:"sandbox",
      description:"Enter sandbox for the DOKU sandbox MCP endpoint or production for live access. MSO derives the official endpoint from this value.",
      links:[{label:"DOKU MCP guide",url:"https://developers.doku.com/accept-payments/doku-mcp-server"}],
    },
  ] },
  linear: {
    id: "linear",
    title: "Linear",
    description: "Verify a Linear personal API key and read the authenticated viewer.",
    feature: false,
    fields: [
      { key: "apiKey", label: "Personal API key", secret: true, required: true, placeholder: "lin_api_…", description: "Linear personal API key sent only as the raw Authorization header to Linear's fixed GraphQL endpoint. Linear OAuth app secrets and MCP tokens are different credentials and are not accepted here.", links: [{ label: "Linear API keys", url: "https://linear.app/settings/account/security" }] },
    ],
  },
  "openai-app": {
    id: "openai-app",
    title: "OpenAI / ChatGPT App",
    description: "Privately bind this MSO installation to its registered ChatGPT MCP App without committing the personal App ID to Git.",
    feature: false,
    fields: [
      { key: "appId", label: "Registered App ID", secret: true, required: true, description: "Private per-installation OpenAI App ID used only to generate .app.json for personal/plugin packaging. Canonical form starts with asdk_app_; plugin_asdk_app_ copied from a browser URL is normalized automatically." },
    ],
  },
} as const satisfies Record<string, AdditionalProvider>;

export type AdditionalProviderId = keyof typeof ADDITIONAL_PROVIDERS;

export const ADDITIONAL_GUIDANCE = {
  mcp: { url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization", reference: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization", steps: ["Sign in to the target application's account that the assistant should use.", "Create a dedicated expiring MCP token with the least required scope. For Baton: Settings → External access → MCP → Advanced token management.", "Enter the exact MCP URL and token only in this private MSO form. Set an optional exact tool allowlist.", "Bind the project MCP declaration to this named MSO user/connection; MSO verifies tool discovery, while the downstream server enforces its token identity and live project roles."] },
  github: { url: "https://github.com/settings/personal-access-tokens/new", reference: "https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens", steps: ["Prefer GitHub OAuth from the Integrations connection source picker. Use this manual token path only when an explicit direct fallback is required.", "Open GitHub fine-grained token settings while signed in to the intended account.", "Set an expiry and grant only the intended repositories and minimum permissions. Use a classic token only when the required operation cannot be expressed with a fine-grained token.", "Copy the token once into this private form. This connection never substitutes for an OAuth/provider-MCP identity and organization policy can still limit access."] },
  vercel: { url: "https://vercel.com/account/tokens", reference: "https://vercel.com/docs/rest-api#creating-an-access-token", steps: ["Open Account Settings → Tokens in Vercel.", "Create a token with an expiry appropriate for this integration.", "Use the account or team that owns the intended Vercel resources.", "Copy the token into this form; its permissions are determined by that account or team membership."] },
  convex: { url: "https://docs.convex.dev/self-hosting", reference: "https://docs.convex.dev/self-hosting", steps: ["Choose the deployment kind first: a Convex Cloud deployment (personal access token or deployment key + name) or a self-hosted deployment (URL + admin key).", "For Convex Cloud, open the dashboard for the intended account or deployment and copy the personal access token or deployment key.", "For a self-hosted deployment, open its administration settings and generate an admin key using the official self-hosting instructions; never reuse a cloud project key for a different deployment.", "Enter the deployment's HTTPS URL (loopback HTTP is only suitable for a deployment on this VPS) and copy the credential once, scoped to the minimum needed access."] },
  resend: { url: "https://resend.com/api-keys", reference: "https://resend.com/docs/dashboard/api-keys/introduction", steps: ["Open API Keys in the Resend dashboard.", "Create a key for the intended environment.", "Choose Full access only when domain management is required. Sending-only keys cannot pass the domain-list check.", "Copy the key once; verified domains and account policy still control sending access."] },
  stripe: { url: "https://dashboard.stripe.com/apikeys", reference: "https://docs.stripe.com/keys", steps: ["Open Developers → API keys in the intended Stripe account.", "Use a restricted key when its available permissions cover the integration.", "Confirm whether you are using test or live mode before copying the secret key.", "Copy the key once and rotate it promptly if it is exposed."] },
  clerk: { url: "https://dashboard.clerk.com", reference: "https://clerk.com/docs/guides/development/api-keys", steps: ["Open the intended Clerk instance in the Clerk dashboard.", "Find its secret key in the API Keys or Developers settings.", "Keep the key server-side and limit access to the intended instance.", "Copy it into this form; this check only confirms Backend API authentication."] },
  supabase: { url: "https://supabase.com/dashboard/account/tokens", reference: "https://supabase.com/docs/reference/api/introduction", steps: ["Open Account → Access Tokens in the Supabase dashboard.", "Generate a personal access token for the account that owns the intended projects.", "Give it a clear name and an appropriate expiry.", "Copy it once into this form; project API keys cannot be used as Management API tokens."] },
  telegram: { url: "https://t.me/BotFather", reference: "https://core.telegram.org/bots/api", steps: ["Create or select the intended bot in BotFather.", "Copy its Bot API token into this private Integrations form; never paste it into a Channel record.", "Create a webhook secret with letters, digits, underscore or hyphen before enabling inbound webhooks.", "MSO verifies the token with Bot API getMe before marking the connection verified."] },
  discord: { url: "https://discord.com/developers/applications", reference: "https://discord.com/developers/docs/quick-start/getting-started", steps: ["Open the intended application in the Discord Developer Portal.", "Create/reset the bot token only if needed and enter it in this private Integrations form.", "For inbound interactions also copy the Application ID and Interactions Endpoint public key.", "MSO verifies the bot token through the Discord REST API; signed interactions are verified separately at the public channel endpoint."] },
  doku: { url: "https://developers.doku.com/accept-payments/doku-mcp-server", reference: "https://developers.doku.com/accept-payments/doku-mcp-server", steps: ["Open DOKU's official MCP Server guide and choose Sandbox first unless this project is explicitly approved for production payments.", "Obtain the DOKU Client ID and MCP API Key for that environment.", "Enter them only in this private setup form; do not paste them into chat, Baton notes, RR, Git, or project MCP JSON.", "MSO calls the fixed official DOKU MCP endpoint with a read-only MCP initialize request before saving the connection."] },
  "openai-app": { url: "https://chatgpt.com/", reference: "https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt", steps: ["Enable ChatGPT developer mode, then create/register the remote MCP app for this MSO installation and complete Scan Tools + OAuth.", "Open the registered app details. Copy the App ID shown there, or copy the technical plugin_asdk_app_… id from the browser URL; do not use the Version ID as the app binding.", "Enter the App ID only in this private Integrations form. MSO normalizes plugin_asdk_app_… to canonical asdk_app_… and never returns the stored value through tool/model responses.", "Use the private plugin staging/link command when packaging. Keep the repository .app.json empty so a maintainer-specific App ID is never committed or distributed to other users."] },
  linear: { url: "https://linear.app/settings/account/security", reference: "https://linear.app/developers/graphql", steps: ["Open Linear → Settings → Account → Security & login → Personal API keys.", "Create a key for this MSO connection only; a workspace-scoped OAuth app or the Linear MCP OAuth session will not work here.", "Grant only the workspace access this connection needs, and set an expiry if the workspace allows it.", "Paste the key into this private form only. MSO calls the fixed https://api.linear.app/graphql viewer query before saving and never returns the key through tools or model responses."] },
} as const satisfies Record<AdditionalProviderId, { url: string; reference: string; steps: readonly string[] }>;

type AdditionalField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  description: string;
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
  github: {
    id: "github",
    title: "GitHub",
    description: "Verify a GitHub personal access token for API access.",
    feature: false,
    fields: [{ key: "apiKey", label: "Personal access token (classic)", secret: true, required: true, description: "A GitHub classic personal access token. Repository access depends on the token's scopes and organization policy." }],
  },
  vercel: {
    id: "vercel",
    title: "Vercel",
    description: "Verify a Vercel API token for the selected account.",
    feature: false,
    fields: [{ key: "apiKey", label: "API token", secret: true, required: true, description: "A Vercel API token. Access is limited by the token owner and any team permissions." }],
  },
  "convex-cloud": {
    id: "convex-cloud",
    title: "Convex Cloud",
    description: "Store a Convex Cloud personal token or verify a deployment key for a named deployment.",
    feature: false,
    fields: [
      { key: "personalToken", label: "Personal access token", secret: true, required: false, description: "Convex Cloud personal access token. Validated through the PAT-authenticated read-only account endpoint." },
      { key: "deployKey", label: "Deployment key", secret: true, required: false, description: "Convex deployment key used with the deployment name below." },
      { key: "deploymentName", label: "Deployment name", secret: false, required: false, description: "Convex deployment hostname prefix. Required together with a deployment key; method-specific requirements are enforced by the UI." },
    ],
  },
  convex: {
    id: "convex",
    title: "Self-hosted Convex",
    description: "Verify a self-hosted Convex deployment using its admin key.",
    feature: false,
    fields: [
      { key: "apiUrl", label: "Deployment URL", secret: false, required: true, description: "HTTPS deployment URL; HTTP is allowed only for a loopback deployment on this VPS." },
      { key: "adminKey", label: "Admin key", secret: true, required: true, description: "Convex admin key for this deployment." },
    ],
  },
  resend: {
    id: "resend",
    title: "Resend",
    description: "Verify a Resend API key and inspect accessible sending domains.",
    feature: false,
    fields: [{ key: "apiKey", label: "API key", secret: true, required: true, description: "A Resend API key. Domain access and sending permissions depend on the key's scope." }],
  },
  stripe: {
    id: "stripe",
    title: "Stripe",
    description: "Verify a Stripe secret key for account API access.",
    feature: false,
    fields: [{ key: "apiKey", label: "Secret key", secret: true, required: true, description: "A Stripe secret key for the intended account and mode." }],
  },
  clerk: {
    id: "clerk",
    title: "Clerk",
    description: "Verify a Clerk secret key for Backend API access.",
    feature: false,
    fields: [{ key: "apiKey", label: "Secret key", secret: true, required: true, description: "A Clerk secret key. Access remains subject to the associated Clerk instance." }],
  },
  supabase: {
    id: "supabase",
    title: "Supabase",
    description: "Verify a Supabase management access token and list accessible projects.",
    feature: false,
    fields: [{ key: "managementToken", label: "Management access token", secret: true, required: true, description: "A Supabase personal access token for the Management API; it is distinct from project API keys." }],
  },
} as const satisfies Record<string, AdditionalProvider>;

export type AdditionalProviderId = keyof typeof ADDITIONAL_PROVIDERS;

export const ADDITIONAL_GUIDANCE = {
  github: { url: "https://github.com/settings/tokens/new", reference: "https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens", steps: ["Open GitHub token settings while signed in to the intended account.", "Choose Generate new token (classic).", "Set an expiry and select only the scopes required for the intended automation; repository access generally requires the repo scope.", "Copy the token once and store it here. Organization policies can still limit its access."] },
  vercel: { url: "https://vercel.com/account/tokens", reference: "https://vercel.com/docs/rest-api#creating-an-access-token", steps: ["Open Account Settings → Tokens in Vercel.", "Create a token with an expiry appropriate for this integration.", "Use the account or team that owns the intended Vercel resources.", "Copy the token into this form; its permissions are determined by that account or team membership."] },
  "convex-cloud": { url: "https://dashboard.convex.dev", reference: "https://docs.convex.dev/management-api", steps: ["Open the Convex dashboard for the intended account or deployment.", "Create the personal access token or deployment key appropriate to the operation you intend to perform.", "For a deployment key, also enter its exact deployment name.", "Copy the credential once and keep it scoped to the minimum needed access."] },
  convex: { url: "https://docs.convex.dev/self-hosting", reference: "https://docs.convex.dev/self-hosting", steps: ["Open the administration settings for your self-hosted Convex deployment.", "Generate an admin key using the official self-hosting instructions; never use a cloud project key for a different deployment.", "Enter the deployment's HTTPS URL; loopback HTTP is only suitable for a deployment on this VPS.", "Copy the admin key into this form and restrict network access to the deployment." ] },
  resend: { url: "https://resend.com/api-keys", reference: "https://resend.com/docs/dashboard/api-keys/introduction", steps: ["Open API Keys in the Resend dashboard.", "Create a key for the intended environment.", "Choose Full access only when domain management is required. Sending-only keys cannot pass the domain-list check.", "Copy the key once; verified domains and account policy still control sending access."] },
  stripe: { url: "https://dashboard.stripe.com/apikeys", reference: "https://docs.stripe.com/keys", steps: ["Open Developers → API keys in the intended Stripe account.", "Use a restricted key when its available permissions cover the integration.", "Confirm whether you are using test or live mode before copying the secret key.", "Copy the key once and rotate it promptly if it is exposed."] },
  clerk: { url: "https://dashboard.clerk.com", reference: "https://clerk.com/docs/guides/development/api-keys", steps: ["Open the intended Clerk instance in the Clerk dashboard.", "Find its secret key in the API Keys or Developers settings.", "Keep the key server-side and limit access to the intended instance.", "Copy it into this form; this check only confirms Backend API authentication."] },
  supabase: { url: "https://supabase.com/dashboard/account/tokens", reference: "https://supabase.com/docs/reference/api/introduction", steps: ["Open Account → Access Tokens in the Supabase dashboard.", "Generate a personal access token for the account that owns the intended projects.", "Give it a clear name and an appropriate expiry.", "Copy it once into this form; project API keys cannot be used as Management API tokens."] },
} as const satisfies Record<AdditionalProviderId, { url: string; reference: string; steps: readonly string[] }>;

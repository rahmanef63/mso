# Alfa model and credential integration

> **Current reference.** Alfa supports BYOK API providers, custom OpenAI/Anthropic-compatible
> endpoints, and a separate OpenAI Codex/ChatGPT-subscription OAuth path. Do not confuse
> that provider login with the ChatGPT MCP connector OAuth described in
> `docs/CHATGPT-PLUGIN.md`.

## 1. Credential store

Alfa's server-side selection and credentials live in private host state (normally
`~/.mso/config.json`, mode `0600`). Built-in environment variables remain fallback inputs.
Credentials are not compiled into the client bundle.

The provider picker is dynamic over MSO's supported, endpoint-pinned provider registry and the
cached `models.dev` capability/pricing catalog. The same provider summaries drive terminal onboarding,
`mso models`, and Settings → AI. A model is marked **FREE** only when numeric `cost.input` and
`cost.output` are both explicitly `0`; missing pricing is not free. For Alfa onboarding, the provider's
free-capable count is further restricted to tool-call-capable models. OpenCode Zen is a built-in pinned
OpenAI-compatible provider at `https://opencode.ai/zen/v1`; its model list is not hardcoded. Custom
providers can still define a base URL and OpenAI- or Anthropic-compatible protocol; custom URLs are
SSRF-checked before use.

## 2. Streaming architecture

```mermaid
flowchart LR
  UI[Alfa UI] --> R[/api/assistant]
  R --> RES[resolve provider + model + credential]
  RES -->|Anthropic protocol| AN[Anthropic streaming adapter]
  RES -->|OpenAI-compatible| OA[OpenAI streaming adapter]
  RES -->|openai-codex| CX[ChatGPT Codex Responses adapter]
  AN --> S[neutral delta / tool_use / done / error stream]
  OA --> S
  CX --> S
  S --> UI
```

The client consumes one neutral stream vocabulary. Provider-specific wire formats are
translated server-side, so changing model provider does not fork the shell UI.

## 3. BYOK API-key providers

For normal OpenAI Platform usage, Alfa uses a user-supplied API key. The OpenAI Platform
API does not mint ordinary `/v1` credentials through the ChatGPT MCP connector flow.
Likewise, an Anthropic/OpenRouter/etc API key is unrelated to MSO's own OAuth server.

A custom endpoint stores its provider metadata in the host config and routes through the
same streaming abstraction after URL/protocol validation.

### Discovering a custom endpoint's models

Instead of making the owner guess model ids, MSO can ask a custom endpoint which ids it
serves and offer them as choices — the same idea as OpenCode's built-in discovery for known
runtimes. It is explicit, never silent: the owner triggers it, reviews the list, and the
models text field stays the source of truth for what is saved.

- **Settings → AI → Add custom provider** has a **Discover models** button that POSTs
  `{baseURL, apiKey, protocol}` to `POST /api/models/discover`; the returned ids render as
  toggle chips that edit the models field (`toggleModelInList`). Discovery only fills the
  field in — it never saves on its own.
- **`mso models add <name> --base-url … --api-key …`** with no `--models` queries the same
  route, confirms interactively (or auto-fills in scripts), and falls back to manual ids
  when discovery fails. The key reaches the server over stdin via `secret_post`, never argv.
- A **saved** custom provider is re-discoverable with `{provider}` (its key comes from the
  host credential store), and `GET /api/models?provider=<slug>` now returns its stored ids so
  the Browse drawer is never empty.

Discovery calls the endpoint's own list API — OpenAI-compatible `GET {baseUrl}/models` with
`Authorization: Bearer`, Anthropic `GET {baseUrl}/v1/models` with `x-api-key` +
`anthropic-version`. It is owner-only, SSRF-pinned through `safeProviderFetch`, bounded in
size and time, and the key is never returned, logged, or echoed back.

## 4. OpenAI Codex / ChatGPT subscription provider

`openai-codex` is a distinct optional Alfa provider. It uses the ChatGPT consumer
OAuth/device flow and the ChatGPT Codex backend rather than the OpenAI Platform
`/v1/chat/completions` API. Its implementation lives in `lib/ai/oauth/codex.ts` and
`lib/ai/codex-stream.ts`.

This path exists so the owner can choose to run Alfa against an eligible ChatGPT
subscription. It is a consumer-backend integration and can be more fragile than the public
Platform API. Tokens are host-side private state.

Connecting this OAuth credential and selecting it for inference are separate actions. The default
Settings action stores `openai-codex` without changing the current provider/model; an explicit
**Connect & use** action switches Alfa after authorization. Existing BYOK credentials such as Google
Gemini remain stored and selectable. Alfa Cockpit may switch provider/model only among connections
already present in Settings; it never creates or copies credentials.

Current Alfa requests through this adapter can carry Alfa's tool definitions; the older
"chat-only/no tools" limitation from the original July plan no longer describes `main`.

## 5. ChatGPT MCP OAuth is different

There are two completely independent OAuth stories:

| Flow | Who is the OAuth server/provider? | Credential grants access to | Stored by |
|---|---|---|---|
| ChatGPT ↔ MSO MCP | **MSO** is the OAuth server | MSO MCP tools (`read/write/exec`) | ChatGPT holds bearer; MSO stores only its hash |
| Alfa `openai-codex` | OpenAI/ChatGPT consumer flow | ChatGPT Codex backend for Alfa model inference | MSO host config |

Authorizing ChatGPT as an MCP client does **not** give Alfa a model credential. Connecting
Alfa to `openai-codex` does **not** grant ChatGPT permission to operate the VPS.

## 6. Data boundary

BYOK means the owner controls the credential; it does not mean prompt/tool data stays on
the VPS. Messages and any tool context included in a model request go to the selected model
provider. Host mutation approval and filesystem boundaries remain separate MSO controls.

## 7. Source map

- `lib/config/store.ts` — credential/provider persistence
- `app/api/config/route.ts` — Settings configuration API
- `app/api/models/route.ts`, `app/api/models/test/route.ts` — catalog/test surfaces
- `lib/models/discover.js` — endpoint model-discovery helpers (list URL, auth headers, bounded parse)
- `app/api/models/discover/route.ts` — `POST /api/models/discover` (owner-only, SSRF-pinned)
- `app/api/assistant/route.ts` — common assistant gateway
- `lib/ai/openai-stream.ts` — OpenAI-compatible streaming
- `lib/ai/codex-stream.ts` — ChatGPT Codex Responses streaming
- `lib/ai/oauth/codex.ts` — Codex OAuth/device flow
- `frontend/svelte/src/lib/settings/` — provider Settings UI

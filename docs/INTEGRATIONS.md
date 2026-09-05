# Native Integrations

Connect Composio, Dokploy, Cloudflare, and Hostinger directly to MSO. No separate
credential application or plugin is required. Composio accepts either a project
API key or an organization API key; these are separate setup methods.

## Browser and terminal

Open `/integrations` on your MSO origin. The page checks your live session and
disables **Open secure form** until the device has Owner permission. Provider
guides remain readable before sign-in. Open MSO sign-in in another tab, then return;
focus/visibility refreshes the session, with **Check sign-in again** as a fallback.
Choose the provider and authentication method, then open its secure form. The old
`/api/integrations/setup` URL remains compatible. The form
includes official links, expandable instructions, masked inputs with show/hide,
and **Validate & save**. Existing stored values are never displayed; blank fields
keep them unchanged. A rejected or unreachable provider does not replace them.

From an interactive terminal with an authenticated MSO session:

```sh
mso provider setup composio project
mso provider setup composio organization
mso provider setup hostinger
```

The command prints a private ten-minute URL on the configured public MSO origin.
The setup token is in the URL fragment, never a query parameter, and is removed
from browser history after loading. Do not paste the URL into chat or logs.
Non-interactive invocation is refused rather than exposing a capability in tool
output. Other credential commands remain available.

## ChatGPT Page

`render_mso_page` with route `/integrations` opens the provider picker.
`integration_setup_open` is write-scoped and opens the selected form directly.
Neither tool accepts credential values. The tool uses the existing **MSO Page**
resource; MSO still exposes only the Block and Page presentation types.

```text
ChatGPT → integration_setup_open(provider, method)
                    │
          safe display data + UI-only grant
                    ↓
              MSO Page form
                    │ direct HTTPS, no owner cookies
                    ↓
          provider validation → private MSO store
```

Page v4 keeps explicit public browser links and provider guides visible even when
a cached chat cannot call the new setup tool. A missing tool or missing private
metadata no longer replaces the whole page with an error. A server update does
not itself refresh the client catalog; reconnect MSO to load new actions.
Older Page resource URIs resolve to the current resource without adding a third
UI type.

The grant reaches the UI through hidden MCP `_meta`. A WeakMap keeps it out of
ordinary result serialization and non-ChatGPT model transports. The UI supports
standards-based MCP Apps initialization and ChatGPT's canonical metadata
envelope. Credential values never enter `tools/call`, `ui/message`, widget state,
local storage, or session storage. Buttons do not require iframe `allow-forms`;
reference links use the host's approved external-link bridge.

A client that cached the older tool catalog must refresh/reconnect the plugin
before invoking `integration_setup_open`. A standards-bridge browser fixture is
not proof that every installed ChatGPT client has refreshed its catalog.

## Security boundary

Each random 32-byte capability is bound to a provider, authentication method, and
issuing principal. Only its hash is persisted in an owner-only file. It expires
after ten minutes, permits at most five provider-check attempts, and is consumed
after one successful validation. Per-grant locks reject concurrent replays.
The session is a short-lived delegated permission; restarting the UI does not
extend its expiry.

The cookie-less setup endpoint performs exact-Origin CORS checks, bounded JSON
parsing, field allowlisting, and bearer authorization. Only that exact API path
is exempt from the owner's normal same-origin mutation check. Other routes retain
their existing authorization and CSRF controls. The issuer requires an owner
session or a write-scoped MCP principal. Public HTML contains no credentials or
setup capability.

The native store uses owner-only filesystem permissions (0600), atomic writes,
and cross-process locking. This is filesystem protection, **not encryption at
rest** or protection from a compromised owner/root account. API keys are sent only
to their selected provider's verification endpoint; Dokploy URLs retain the
existing DNS-pinned SSRF checks. Raw provider errors are not returned to the form.

Composio connected-account OAuth tokens remain with Composio. Configuring an API
key is not the same as completing OAuth for every application connected there.
A scoped key may authenticate but lack access to the endpoint being checked; the
form fails closed instead of claiming successful access.

## Official references

- [Composio authentication](https://docs.composio.dev/reference/authenticating-to-composio)
- [Cloudflare token creation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Hostinger API](https://developers.hostinger.com/)
- [Dokploy API](https://docs.dokploy.com/docs/core/api)
- [OpenAI plugin UI reference](https://developers.openai.com/plugins/reference)

## Verification

Focused tests cover capability expiry, replay, provider/method isolation,
validation-before-write, secret redaction, strict CORS, bounded request bodies,
owner-only store permissions, and MCP output separation. Browser fixtures cover
desktop/mobile Page rendering, standards-bridge initialization, failed validation
and retry, input clearing, no owner cookies, and no credential in host messages.
Real provider authentication still requires the user's own valid credential.

### Deployment verification

The service release lifecycle waits for the root HTTP endpoint after observing a
replacement systemd process, then verifies every referenced JS/CSS asset. A new
process alone is not HTTP readiness. The bounded wait does not waive missing
chunks, incorrect MIME types, or fallback-runtime restoration requirements.

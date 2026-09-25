# Native Google integrations

MSO owns the provider connection, consent lifecycle and bounded API dispatch. Composio is optional and is not needed by these Google providers. This is a scoped foundation, not complete Composio feature parity.

## One identity model

Credential owner → provider → named connection → source/authentication stays the existing MSO Integrations model. App configuration and a user's authorization are different records:

- `google-oauth-app` / direct / `oauth-app`: the installation's Google Web application client ID and secret, entered only through the existing private setup form. Saving validates configuration format, not account access.
- `google-search-console` / direct / `oauth2`: an explicit same-owner OAuth app binding and read-only Search Console authorization.
- `google-analytics` / direct / `oauth2`: an explicit same-owner OAuth app binding and read-only GA4 authorization.

A client ID, API key, GA measurement ID or browser login cookie does not grant private Search Console or Analytics access. Each named Google connection requires account consent. An imported/copied connection requires fresh user authorization even when app configuration is copied.

## Installation setup, then account connection

1. Set `OS_PUBLIC_ORIGIN` to the canonical HTTPS origin of this MSO installation. Never derive the OAuth redirect from an untrusted request header.
2. Select or create a Google Cloud project owned by the operator. Enable Search Console API and/or Analytics Admin API + Analytics Data API as needed.
3. Configure the Google consent screen and a **Web application** OAuth client. Register the exact redirect shown by MSO: `<OS_PUBLIC_ORIGIN>/api/integrations/google/callback`.
4. In MSO Integrations, create a Google OAuth app connection under the intended credential owner. Enter the client ID and secret through private setup. This is a once-per-app setup, not a key prompt for every end user.
5. Add a named Search Console or Google Analytics 4 connection, choose the app, then **Connect with Google → Continue to Google**. Consent runs in a top-level browser, not inside the ChatGPT embed.
6. Return to MSO, refresh, and **Verify API access**. An empty property/account list can be a valid result; it does not prove the desired property is accessible.

Google test-user restrictions, Workspace policy, consent-screen verification and API enablement remain Google's controls. MSO does not bypass them. Hosted centrally managed OAuth-app provisioning is a future distribution capability, not an implicit dependency or a claim of this release.

## Shared machine interface

The existing `integration_query` catalog includes each native Google's `operations` with strict JSON input schemas. The existing `integration_execute` resolves the exact credential owner and named connection.

Connection operations:

- `google.bind` with `{appConnection}` selects a configured app owned by the same credential owner.
- `google.operations.list` returns the connection's bounded read-operation schemas.
- `verify` tests a real Google read endpoint, rather than interpreting stored fields as authorization.
- `google.disconnect` forgets MSO's local grant. The result explicitly says it has **not** revoked the Google app itself. Review Google Account third-party connections to revoke the app across services.
- `integration_manage` / `connection.authorize` returns only a native UI entrypoint. It never exposes an authorization state, PKCE verifier, OAuth code or token to MCP.

Read operations:

| Operation | Purpose |
| --- | --- |
| `google.searchConsole.sites.list` | Accessible properties and permissions |
| `google.searchConsole.searchAnalytics.query` | Bounded Web/Image/video performance report |
| `google.searchConsole.sitemaps.list` | Existing sitemap metadata, not submission |
| `google.searchConsole.url.inspect` | Google's stored index inspection, not live crawl or indexing request |
| `google.analytics.accountSummaries.list` | Accessible accounts/properties, with pagination |
| `google.analytics.report.run` | Bounded GA4 report, not Measurement Protocol events |

Arguments use Google's camelCase field names; use the returned property identity verbatim. Follow schema bounds and pagination. Filters, custom metric syntaxes, service-account credentials, write operations, webhooks and broader Google products are not silently supported by this slice.

## MCP client refresh

Native Google operations require toolset `2026.09.25.1` or newer. The provider
operation enum is derived from the same Google operation catalog as the backend,
and private setup uses the shared method list. Both full and ChatGPT descriptors
are tested through actual MCP dispatch, not only direct helper calls. The global
tool count does not increase: these remain operations on the existing Integrations
capabilities. Refresh a client's action/schema snapshot after upgrading. A local
MSO acknowledgement does not remotely refresh ChatGPT or another client.

## Status semantics

`app-configured` is not a user connection. Service states distinguish `app-required`, `authorization-required`, `authorization-pending`, `authorized`, `verified`, `reauthorization-required`, `scope-missing`, `invalid` and `unavailable`. Failed verification never retains a stale green state. Consent alone does not verify access to a particular property. Changing a pinned OAuth app's credentials invalidates existing grants until reauthorization. Reconnect must retain the same Google account; disconnect explicitly before switching accounts.

## Security boundary

- Random state + PKCE S256, ten-minute single-use flow, hashed browser binding and a host-only Secure/HttpOnly/SameSite=Lax flow cookie. The existing main MSO session cookie remains Strict.
- Owner-only, same-origin start; callback checks the binding, exact app/connection revisions and the issuing device's current Owner role, session expiry and policy epoch. Callback failures do not echo provider messages or codes.
- Exchange and refresh use fixed official HTTPS endpoints, bounded bodies/timeouts and no redirect following. Read adapters also reject unknown arguments and arbitrary endpoints.
- Tokens remain in the existing owner-only locked/atomically written Integrations store. They are excluded from connection summaries, shared aliases, duplication, raw credential export and portable bundles.
- Network requests occur outside the file-store lock, with bounded app/connection leases and final revision checks.
- This code does not log token/code/query values. Operators must also keep reverse-proxy/access logs from retaining OAuth callback query strings. Infrastructure log policy is not proven by a unit test.
- Real Google consent/API access is a separate acceptance step requiring an authorized operator. Mock tests never constitute evidence that a production Google account is connected.

## Composio-class parity roadmap

This slice provides native catalog/configuration, explicit account consent, lifecycle status, refresh, local disconnect and shared machine/UI dispatch. It does not claim an equivalent provider inventory or every Composio feature.

Next phases: richer property selection and report UI; centralized provider-operation validation/adapter scaffolding; per-action activity/error history; optional service-account methods; triggers/webhooks and scoped write actions; managed OAuth-app distribution with documented Google verification; browser-verified setup journeys for each provider.

The user-requested **embed padding/margin** pass is deliberately separate and deferred: shared outer gutters, aligned header/form/help, narrow-width stacking, focus visibility and iframe height/scroll parity. Do not create a second design system or change auth semantics to repair spacing.

## Primary references

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/webmaster-tools/v1/sites/list
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
- https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport

# 9Router default MSO app-host: design note

Status: proposal for the implementation agent. This note records an observed deployment failure mode and the security contract the default 9Router setup should converge on. It deliberately does not change production routing or authentication by itself.

## Problem observed

A managed 9Router installation can be healthy on `127.0.0.1:20128` while `publicDashboardUrl` remains unset. It is tempting to fix that by routing a public hostname directly to the 9Router container. That makes the dashboard reachable, but it bypasses MSO's managed-app authentication boundary. On the observed runtime, `/dashboard` returned `200` without a separate 9Router login, so a direct reverse-proxy route would expose the management UI to anyone who can reach the hostname.

The desired owner experience is simpler and safer:

- the canonical browser URL is `https://9router.mso.<owner-domain>/`;
- users authenticate once to MSO, not once to MSO and again to 9Router;
- the 9Router service itself stays private and is not independently reachable from the public Internet;
- MSO remains the policy enforcement point for browser access.

This is **session unification at the MSO boundary**, not password synchronization. MSO credentials/session material must never be copied into, stored by, or forwarded to 9Router.

## Target request path

```text
browser
  -> Cloudflare / DNS / TLS
  -> 9router.mso.<owner-domain>
  -> MSO managed-app host router
  -> MSO session + approved-device authorization
  -> MSO managed-app proxy
  -> http://127.0.0.1:20128
  -> 9Router
```

The public route must terminate at MSO, **not** at `9router:20128` and not at a host-published public port.

The current split-origin machinery already provides the important security primitives:

- `proxy.ts` maps only declared managed-app hosts and does not expose cockpit routes on them;
- the managed-app proxy calls `verifyAuth()` before proxying HTTP;
- WebSocket upgrades have their own approved-session gate;
- the cockpit `session` cookie is stripped before requests are forwarded upstream;
- upstream cookies are namespaced per managed app;
- the proxy target is constrained to loopback for ordinary HTTP proxying;
- unknown hosts inside the managed-app namespace fail closed instead of serving the cockpit.

The implementation should reuse those primitives rather than create a second auth system for 9Router.

## Recommended default behavior

When MSO has enough information and authority to manage the deployment domain, installing 9Router should prefer the MSO app-host path automatically:

1. Keep the container host publish at `127.0.0.1:20128:20128`.
2. Configure/use `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE={id}.mso.<owner-domain>`.
3. Configure/use `OS_SESSION_COOKIE_DOMAIN=.mso.<owner-domain>` and ensure the cockpit public origin is explicit.
4. Provision only the explicit `9router.mso.<owner-domain>` DNS/TLS route required for the app host.
5. Route that hostname to the MSO web service / app-host proxy, not to the 9Router container.
6. Require the user to sign in to MSO again after widening the cookie domain so the new cookie scope is actually issued.
7. Prefer the app-host URL for the managed 9Router UI and keep `publicDashboardUrl` aligned with it.

If MSO lacks DNS/TLS authority, installation must still succeed with 9Router private and healthy. The UI should explain that browser access is pending app-host provisioning rather than suggesting a direct public-port exposure.

## No second login: security conditions

Skipping a separate 9Router login is safe only when **all** of the following are true:

- every public browser request to the 9Router UI passes through the MSO app-host auth gate;
- `20128` is loopback-only on the host;
- no legacy hostname routes directly to the 9Router container;
- no public-IP fallback is enabled (`NINE_ROUTER_EXPOSE_PUBLIC` remains off by default);
- MSO strips its own session/auth headers before forwarding upstream, as it does today;
- logout/revocation at MSO immediately prevents new proxy access;
- any WebSocket/SSE paths used by 9Router are protected by the same MSO session boundary;
- the implementation has a defined answer for non-browser callers instead of silently making the private management UI an unauthenticated API gateway.

If 9Router itself later adds a mandatory vendor authentication layer that cannot be safely disabled for a loopback-only trusted proxy, MSO should not fake or synchronize passwords. The implementation must either keep that vendor auth or use a documented upstream trusted-proxy/SSO mechanism.

## Docker-network caveat

A loopback host bind does not by itself make an unauthenticated container safe if the container is also attached to a broad shared Docker network. Another compromised container on that network may be able to reach `9router:20128` by container DNS/IP even though the host port is private.

Therefore an implementation that intentionally relies on **MSO-only authentication** should also review network reachability:

- prefer no shared proxy network when the app-host route terminates at MSO and MSO reaches 9Router through loopback;
- otherwise use a dedicated/private network with only the minimum required peers;
- do not attach 9Router to `dokploy-network` merely so Traefik can proxy directly to it, because the target architecture does not require that direct path.

This network constraint is part of the auth boundary, not optional hardening.

## Migration / cleanup rules

When adopting the app-host default on an existing install:

1. Verify loopback health (`/api/health`) first.
2. Provision and verify `9router.mso.<owner-domain>` through MSO.
3. Verify an unauthenticated request to the app-host is rejected and an authenticated MSO session succeeds.
4. Verify the MSO session cookie is not present in the upstream 9Router request.
5. Verify WebSocket/SSE functionality if the dashboard uses it.
6. Remove any direct public route such as `9router.<owner-domain> -> 9router:20128` unless the operator explicitly chose a separate, independently authenticated exposure model.
7. Remove stale DNS only after the MSO app-host path is proven working.
8. Keep rollback possible without reopening a direct unauthenticated route.

An old standalone hostname must not remain as an accidental authentication bypass just because it existed before MSO began managing the app.

## UX expectation

The normal owner flow should be one conceptual setup:

```text
Install 9Router -> MSO verifies runtime -> MSO prepares app-host -> user opens 9Router from MSO
```

The user should not need to understand container ports, Traefik service names, cookie domains, or a second password merely to use a managed app. Advanced operators may still opt into a standalone/vendor-authenticated exposure, but that is an explicit exception rather than the default path.

## Acceptance criteria for the implementation PR

- Fresh managed install keeps `20128` off public interfaces.
- With a configured MSO domain/provider, `9router.mso.<owner-domain>` is provisioned or surfaced as the deterministic desired hostname.
- The hostname routes to MSO, never directly to the 9Router container.
- Anonymous navigation to the app-host cannot reach 9Router content.
- One valid MSO owner/operator session can use the 9Router dashboard without a second MSO-created password prompt.
- MSO session/auth material is absent from upstream requests.
- Device revocation/session expiry blocks subsequent app-host access.
- Direct legacy hostname/public-port bypasses are detected and clearly reported during migration.
- Shared-network reachability is either removed or explicitly constrained before relying on MSO as the only browser authentication layer.
- Existing lifecycle health/update/backup behavior continues to work without DNS as a hard dependency.

## Non-goals

- Do not copy the MSO password into 9Router.
- Do not teach MSO to know or reset a vendor password unless upstream explicitly requires and documents that integration.
- Do not make 9Router share the cockpit origin.
- Do not weaken the existing split-origin/cookie isolation to remove a login prompt.
- Do not make successful DNS provisioning a prerequisite for starting or health-checking the runtime.

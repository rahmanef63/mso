# T3 Code Integration Architecture & Security Contracts

Status: **implemented as a managed application adapter**. No T3 Code source code is copied or
vendored into MSO; MSO owns only the catalog entry, split-origin HTTP/WebSocket proxy, and the
SHA-256-verified lifecycle adapter (`scripts/managed-app-t3`).

Target: `pingdotgg/t3code` `v0.1.11` standalone Linux server (`linux-x64` and `linux-arm64`),
bound to loopback `127.0.0.1:3773` by default.

## 1. Split-origin framing & CSP containment

T3 Code sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on
its HTTP responses. MSO serves T3 Code strictly through its dedicated split-origin host
(`https://t3.<managed-app-host>` from `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE`):

- **Response header allowlist**: `lib/managed-apps/proxy-headers.ts` strips upstream
  `X-Frame-Options` and rewrites `Set-Cookie` / `Location` headers to the isolated app origin.
- **CSP intersection**: `lib/managed-apps/proxy-csp.ts` overrides `frame-ancestors` to the
  cockpit origin while preserving T3 Code's asset, WebSocket (`wss://`), worker, and
  `'wasm-unsafe-eval'` requirements.
- **WebSocket relay**: `lib/managed-apps/socket-policy.ts` gates upgrades on a live MSO
  Operator/Owner device session and continuously re-authorizes open sockets.

## 2. Lifecycle & supply-chain verification

- **Pinned release artifacts**: `security/managed-app-artifacts.env` locks `T3_VERSION`,
  the official GitHub release URLs, and 64-hex SHA-256 checksums for `linux-x64` and
  `linux-arm64`.
- **Installation**: `scripts/managed-app-t3 install` verifies the tarball SHA-256 before
  extraction into `~/.local/share/mso/t3/releases/t3-<version>` and writes the loopback-only
  user systemd unit `~/.config/systemd/user/t3-code.service` (`--host 127.0.0.1 --port 3773
  --base-dir ~/.t3 --no-browser`).
- **Existing local runtime safety**: if an existing T3 Code server is already answering
  `http://127.0.0.1:3773/api/auth/session` while `t3-code.service` is inactive, install keeps
  that live process undisturbed while registering the pinned binary and user unit.
- **Update & uninstall**: `update --yes` reconciles to the pinned release in
  `security/managed-app-artifacts.env`; `uninstall --yes [--dry-run]` removes `t3-code.service`
  and `~/.local/share/mso/t3` while preserving user data in `~/.t3`.

## 3. Roles & operational boundaries

- **Roles**: Viewer is denied; Operator and Owner are allowed (`lib/auth/app-access.ts`).
- **T3 authentication**: T3 Code keeps its own authentication/pairing model (`t3 pair`,
  `t3 auth`) behind MSO's outer Operator/Owner device session gate.
- **DNS / tunnel prerequisite**: embedded iframe access requires routing `t3.<managed-app-host>`
  (for example `t3-mso.example.com`) to the MSO server port with `Host` preserved.

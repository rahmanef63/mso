# FAQ

### Is MSO a real operating system?

No. It is a self-hosted Next.js application with an OS-style workspace metaphor. The value
is practical server control—Files, Terminal, Code, metrics, Browser, AI and managed apps—in
one responsive browser UI.

### Is it safe to expose to the public internet?

Treat an authenticated owner session like SSH. MSO has signed sessions, device approval,
filesystem bounds, rate limits and audits, but no third-party security audit. Prefer
Tailscale/VPN or a tightly controlled HTTPS reverse proxy. Public showcases should use a
separate `NEXT_PUBLIC_OS_DEMO=1` mock-only build.

### Why password plus device approval?

The password proves the owner knows the login secret; device approval prevents a new browser
from receiving an owner session until an existing trusted device or the server approves it.
It is a browser allowlist, not standards-based MFA.

### I lost all approved devices. How do I get back in?

Use a trusted host-admin path to approve the device id shown on the login page with
`scripts/approve-device.js`, or inspect the allowlist on the server. Do not expose the
allowlist through the normal Files API.

### Can multiple people use one MSO installation?

It is single-owner by design. There is no multi-user RBAC for the cockpit. Do not hand out
sessions you would not hand a shell.

### Why no database?

Core state is small: signed sessions are stateless, device/config/MCP/audit state lives in
private owner-local files, and UI/window state is browser-side or in the existing preference
store. Managed applications keep their own independent state.

### Can I run MSO as root?

Do not. Run it as a normal dedicated user. The process user's Unix permissions are another
important boundary beyond MSO's own path checks.

### What are mock and live modes?

The shell can use mock adapters for safe demos/development and live host adapters for the
real VPS. A public demo build is forced mock-only and does not expose live host operations.

### How do I add an MSO app?

Create a vertical slice under `frontend/slices/<slug>/` and register its descriptor in the
MSO shell manifest. Dock/launcher/search/routing/windowing consume the manifest rather than
requiring per-surface edits. Shell features are nested under `appshell/features/*`; see
`docs/ARCHITECTURE.md` and `docs/SLICE-CATALOG.md`.

### Can I reuse slices outside MSO?

That is a design goal. AppShell is generic and application slices keep their host coupling
behind small adapters/contracts so they can be lifted into compatible Next.js projects.

### What does the Browser app actually run?

Camoufox: a real anti-fingerprinting Firefox on a headless X display, streamed through
noVNC. It is optional and off when not needed. The old Playwright browser daemon is retired;
Playwright remaining under `os-browser/` is development/test tooling only.

### Why can Browser status not return the VNC password?

The persistent Camoufox profile can contain live logged-in cookies. Model-facing status APIs
therefore return only installed/running/autostart state. Human viewer credentials stay on
the owner side.

### What are Hermes and OpenClaw inside MSO?

Independent managed applications. MSO can install/control/log/update/back up/restore them and
optionally frame each vendor dashboard from a separate hostname. Their plugins still run
with the daemon's host privileges; MSO's browser origin split does not sandbox daemon code.

### Why is a managed-app dashboard not embedded by default?

Vendor SPAs need `allow-same-origin`. On the cockpit origin that would share the owner's
browser realm/session. The safe default is no embedded dashboard; split-origin embedding is
an explicit two-variable deployment decision. See `docs/MANAGED-APPS.md`.

### Can ChatGPT control MSO?

Yes, through the optional remote MCP server. Enable it deliberately, connect a ChatGPT
custom MCP app/connector over OAuth 2.1 + PKCE, and grant `read`, `write` or `exec` scope.
Full details and diagrams are in `docs/CHATGPT-PLUGIN.md`; protocol/security internals are in
`docs/MCP.md`.

### Is "Sign in with OpenAI" in Alfa the same as the ChatGPT plugin?

No. Alfa's `openai-codex` option is a model-inference credential using a ChatGPT consumer
flow. The ChatGPT MCP app gives ChatGPT a scoped MSO bearer so it can call VPS tools. One
does not grant the other.

### Can ChatGPT send a generated image/file into the VPS?

Yes. `fs_upload_file` accepts a ChatGPT-provided temporary file reference, validates the
OpenAI download host/redirects/type/size, and writes it inside `OS_FS_WRITE_ROOTS`. MSO does
not maintain a second image generator; use ChatGPT's native generation, then transfer the
result.

### Does MCP expose every project automatically?

Project discovery searches configured containers with containment/ownership checks and hard
work bounds. A truncated scan comes with continuation metadata; it must not be interpreted
as a complete "not found" result. Project function calling is opt-in through
`.mso/functions.json` and always exec-scope.

### What does it cost to run?

The MSO Node process is modest compared with a full remote desktop, but exact RSS/build
needs depend on the host and enabled features. A production build needs significantly more
memory than idle runtime. Camoufox adds a real Firefox/X/VNC stack while it is running, so
leave it off on small boxes when not needed.

### How is the codebase checked?

Every normal push is expected to pass typecheck, lint, the full Vitest suite, cycle/doc/skill
checks, high/critical dependency audit and an out-of-tree production build. Dated audits are
historical evidence; current behaviour is validated continuously by the gates and current
reference docs.

### Phone support?

Mobile is a first-class surface. Portrait uses iOS/Android-style shells with safe-area and
single-owner navigation rules; phone landscape can resolve to the desktop surface. Current
shell E2E covers desktop, phone portrait and phone landscape.

### Why is the repo called `mso` but product text says MSO / Manef Shell OS?

`mso` is the stable repo/service/deploy slug. **Manef Shell OS** is the product name and
**MSO** is the short UI mark. Keeping the technical slug stable avoids churn in paths,
services and URLs.

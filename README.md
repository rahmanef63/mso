<h1 align="center">Manef Shell OS</h1>
<p align="center"><strong>A self-hosted control plane for AI agents.</strong></p>
<p align="center">Let agents work across your projects, tools, workflows and infrastructure while keeping context, permissions and execution evidence under your control.</p>
<p align="center"><a href="https://manef.dev/mso/demo">Interactive Demo</a> · <a href="https://mso.manef.dev/">Full Demo</a> · <a href="./docs/QUICKSTART.md">First 10 minutes</a> · <a href="#install-or-update-mso-from-this-repo">Install</a> · <a href="./docs/LAUNCH-READINESS.md">Launch readiness</a> · <a href="./docs/README.md">Docs</a></p>
<p align="center"><a href="https://github.com/rahmanef63/mso/actions/workflows/ci.yml"><img alt="Tests and build" src="https://github.com/rahmanef63/mso/actions/workflows/ci.yml/badge.svg" /></a> <a href="https://github.com/rahmanef63/mso/actions/workflows/security-alerts.yml"><img alt="Actual open security findings" src="https://github.com/rahmanef63/mso/actions/workflows/security-alerts.yml/badge.svg" /></a> <a href="./LICENSE"><img alt="License: PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-blue" /></a></p>

## See it work

**Live public demos (mock data only, no host access):** [Interactive preview (`Desktop` / `Tablet` / `Phone`)](https://manef.dev/mso/demo) · [Full standalone workspace (`mso.manef.dev`)](https://mso.manef.dev/)

| Recorded Spotlight & server walkthrough | Hybrid Svelte 5 + Bun + Rust Shell (`mso-shell-host`) live walkthrough |
|---|---|
| [![MSO recorded walkthrough: open Spotlight and inspect the server](./docs/media/demo.gif)](./docs/media/demo.gif) | [![Svelte 5 + Bun + Rust Shell live walkthrough and benchmark](./docs/media/svelte-rust-perf.gif)](./docs/media/svelte-rust-perf.gif) |

| Your server, visually | Your tools, in the terminal | Measured Svelte 5 + Bun + Rust Shell benchmark |
|---|---|---|
| ![MSO desktop and mobile workspace](./docs/media/mso-hero.webp) | ![Interactive `mso` Agent terminal](./docs/media/mso-cli.webp) | ![Svelte 5 + Bun + Rust Shell benchmark evidence](./docs/media/hybrid-svelte-rust-bench.webp) |

**Hybrid Svelte 5 + Bun 1.4.2 + Rust Shell (`rustc 1.99.1`) same-host benchmark ([full plan & runbook](./docs/RUST-SHELL-PLAN.md)):** **557 KiB** zero-crate Rust binary (`2.58 ms` cold ready), **2.52 / 2.81 MiB** idle/active `VmRSS` (**-99.1% RAM** vs ~284 MiB Next.js), **0.301 ms** p50 HTML+CSP Nonce TTFB (**~35x faster**), **140.0 KiB** cold first-load JS across 33 lazy slices (**-84.7%** vs ~910 KiB), **1,712 / 1,700 ms** cold Slow 4G + 4x CPU Desktop/Mobile LCP (`7 / 3 ms` TBT), and **0.365 ms** p50 native Rust `fs_jail` search (`0` Node calls).

## More than an AI chat window

| Ask it to… | What MSO brings |
|---|---|
| **Understand a project** | Project context, trusted skills and task-specific tool discovery. |
| **Do the work** | Real PTY, bounded file tools, service controls and explicit approvals. |
| **Pick up where you left off** | Durable sessions, local memory, workflow evidence, agent handoffs and [separate repo progress vaults](./docs/AGENT-VAULT.md). |
| **Build server-native workflows** | Server-native n8n-core workflow parity: schedule/webhook triggers, branching/loops/subflows, retries/error paths, versions/history, private variables, integrations, per-node logs, and automatic private learning. |

**One runtime, three ways in:** use desktop/mobile windows, stay in your terminal, or connect an MCP client.
Code, image/video tools, a browser and native credential setup live beside your operational tools.

```mermaid
flowchart LR
    You["You"] --> Web["Browser · desktop / mobile"]
    You --> CLI["MSO CLI"]
    You --> MCP["MCP client"]
    Web & CLI & MCP --> Core["MSO · auth / scopes / approvals"]
    Core --> Work["Projects · files · PTY · services"]
    Core --> Agents["Agents · skills · durable sessions"]
    Agents --> Evidence["Verify · record · resume"]
    Agents -. BYOK .-> Model["Your model provider"]
```

[Private session screenshots](./docs/SESSION-ARTIFACTS.md) · [How the agent runtime works](./docs/COGNITIVE-RUNTIME.md) · [Architecture](./docs/ARCHITECTURE.md) · [Native Integrations](./docs/INTEGRATIONS.md)

## Install or update MSO from this repo
**Linux, macOS, Windows/WSL2, Android/Termux · iOS/iPadOS client.** MSO keeps one Linux host-runtime contract and adapts the machine around it.

| Machine | Supported path |
|---|---|
| Linux | Native host — canonical POSIX installer |
| macOS | Lima Linux guest — canonical POSIX installer auto-routes |
| Windows | WSL2 Linux distro — PowerShell bootstrap |
| Android | Termux + Ubuntu PRoot — canonical POSIX installer auto-routes |
| iOS / iPadOS | PWA/client to a protected MSO host |
```bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
mso doctor
mso
mso web
```
Windows PowerShell: `iwr -useb https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install-windows.ps1 | iex`.

The raw application binds to **127.0.0.1** by default. Compatibility hosts manage their Linux runtime, not native parent-OS services. [Platform support](./docs/PLATFORMS.md) · [Full installation guide](./docs/INSTALL.md) · [Android / Termux details](./docs/TERMUX.md) · [CLI reference](./docs/CLI.md)

<details>
<summary><strong>Update, reset or uninstall — preview before changing anything</strong></summary>

`mso update` updates from main. `mso reset` and `mso reset --scope all` preview configuration/factory resets;
`mso uninstall --purge --remove-code` previews removal of owned data and a clean standalone clone.
Applying reset/uninstall requires an offline runtime and an exact confirmation token from an independent terminal.
Browser reset is separate in **Settings → Account → About**. [Backups, scope and safeguards](./docs/MAINTENANCE.md).

</details>

## Use MSO from an AI app (MCP)

Connect ChatGPT, Codex, Claude Code, Cursor, or another compatible MCP client to your MSO installation. **You do not need SI-Coder**: it is an optional MSO plugin, not the MCP server or an installation prerequisite.

1. Open **Settings → MCP → Access MSO → Connect an app** and choose your client.
2. Copy the server URL shown there (`https://mso.example.com/mcp` is a placeholder), select **OAuth**, and authorize on an approved MSO owner device.
3. Grant the minimum useful scope, refresh/scan the client's tools, and enable MSO in the conversation. Start with: `@MSO check server status without changing anything`.

| Direction | What it does |
|---|---|
| **Access MSO** | Your AI app → MSO → permitted server/project operations. |
| **MSO Access** | MSO → external services/project MCPs with separately configured credentials. |

Fresh installs enable MCP with an `exec` ceiling; existing installs preserve their settings.
`read` observes, `write` adds bounded changes, and `exec` permits host/delegated execution.
A ceiling is not a grant: actual token scope and server guards still apply. Lower the ceiling
when shell access is unnecessary. Never paste passwords or tokens into a prompt.

[How to use MCP — Bahasa Indonesia](./docs/MCP-HOW-TO.md) · [ChatGPT setup/reference](./docs/CHATGPT-PLUGIN.md) · [Protocol and security](./docs/MCP.md) · [Generated tool catalog](./docs/generated/MCP-CATALOG.md)

## Build with it
```bash
bun install --frozen-lockfile
bun run gate:smart && bun run check:features && bun run verify
bun run test:features && bun run audit:strict
```

Use Bun >=1.2.15 with native audit support. [Contributing](./CONTRIBUTING.md) · [Development](./docs/DEVELOPMENT.md) · [Modular features](./docs/MODULAR-FEATURES.md) · [Changelog](./docs/CHANGELOG.md)

## Powerful by design. Not a sandbox.

**Public Alpha / Developer Preview.** Owner/exec authority can run commands as the service user.
Provider calls may send selected context off-host. Review approvals and keep credentials private.
Successful analysis jobs are not proof of zero open alerts; the security badge above checks the actual inventory.
[Security policy](./SECURITY.md) · [Verification and known limits](./docs/SECURITY-ASSURANCE.md)

<!-- comparison:start -->
[Product comparison, evidence and limitations](docs/COMPARISON.md) · reviewed 2026-09-17.
<!-- comparison:end -->

**License ([PolyForm Noncommercial 1.0.0](./LICENSE)):** Free to use, modify, and self-host for personal, educational, and noncommercial use. **Commercial use, resale, or paid hosting is prohibited** without a written [commercial license](./LICENSE-EXCEPTION.md). · [Third-party notices](./LICENSES/THIRD-PARTY-NOTICES.md) · [Code of Conduct](./CODE_OF_CONDUCT.md) · [Workspace guide](./docs/reference/WORKSPACE-GUIDE.md)

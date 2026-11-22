# MSO Desktop Shell (`mso-desktop-tauri`, Stage R1)

Standalone Tauri v2 native desktop client scaffold for MSO. It wraps the shared Svelte static
bundle (`frontend/svelte/build`) in a least-privilege native WebView and connects to either a
local loopback MSO host (default `http://127.0.0.1:4005`) or a remote HTTPS MSO host
(`https://mso.example.com`).

> **Workspace isolation note:** This crate intentionally declares its own empty `[workspace]` and
> is NOT listed in `rust-shell/Cargo.toml` workspace members. That keeps
> `cd rust-shell && cargo test --workspace` zero-dependency and offline-compilable on hosts
> without WebKitGTK/GTK3 or crates.io access.

## Architecture & Security Contract

- **Shared core validation:** Reuses `mso_shell_core::desktop::{DesktopHostProfile, parse_deep_link, render_bridge_bootstrap_json}` from `../crates/mso-shell-core`.
- **Host origin configuration:** Set `MSO_DESKTOP_HOST_ORIGIN` before launching to target a loopback origin (`http://127.0.0.1:4005`, `http://localhost:4005`, `https://[::1]:8443`) or a remote HTTPS origin (`https://mso.example.com`). Plaintext remote HTTP, embedded credentials, paths, queries, and control characters fail closed at startup.
- **WebView bridge injection:** Injects read-only `window.__MSO_DESKTOP_SHELL__` (from `render_bridge_bootstrap_json`) and `window.__MSO_SHELL__` (`{ surface: "tauri-desktop", apiBaseOrigin }`) for `frontend/svelte/src/lib/shell-bridge.ts`, gated to bundled `tauri:` / `tauri.localhost` and loopback origins.
- **Deep-link validation:** Registers the `mso` deep-link scheme metadata (`plugins.deep-link.desktop.schemes = ["mso"]`) and exposes `resolve_deep_link(uri)` backed by `parse_deep_link`, blocking non-`mso://open/<slug>` URIs, path traversal, control bytes, and reserved route prefixes (`/api`, `/_next`, `/mcp`, `/oauth`, `/.well-known`, `/a2a`). OS-level scheme registration requires enabling `tauri-plugin-deep-link` during native packaging.
- **Least-privilege capabilities:** `capabilities/default.json` grants `core:default` only to the single `main` window, with no broad shell, filesystem, or HTTP wildcard permissions.
- **Strict CSP:** `tauri.conf.json` forbids `'unsafe-inline'` scripts, `'unsafe-eval'`, objects, and framing, restricting plaintext `http:`/`ws:` `connect-src` targets to loopback and Tauri IPC only.

## OS Prerequisites

### Linux (Debian / Ubuntu)

```sh
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  pkg-config \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### macOS

- Install Xcode Command Line Tools:
  ```sh
  xcode-select --install
  ```
- Install Rust via `rustup` (`rustc` + `cargo`, stable toolchain) and `bun`.

### Windows

- Install Microsoft Visual Studio C++ Build Tools (MSVC + Windows 10/11 SDK).
- Ensure Microsoft Edge WebView2 Runtime is installed (included by default on Windows 11 and modern Windows 10).
- Install Rust via `rustup` (`stable-x86_64-pc-windows-msvc`) and `bun`.

### Tauri CLI (all platforms)

```sh
cargo install tauri-cli --version "^2" --locked
```

## Build & Run Commands

1. Build the shared Svelte static frontend from the repository root:

   ```sh
   bun run svelte:build
   ```

2. (Optional, before creating release installers) generate platform icon assets inside
   `rust-shell/desktop-tauri/icons/` from the official MSO PNG icon and add `bundle.icon` to
   `tauri.conf.json`:

   ```sh
   cd rust-shell/desktop-tauri
   cargo tauri icon ../../public/icon-512.png
   ```

3. Run desktop unit tests and build the Tauri v2 bundle:

   ```sh
   cd rust-shell/desktop-tauri
   RUSTFLAGS="-D warnings" cargo test
   cargo tauri build
   ```

4. Launch against a local loopback or remote HTTPS MSO host:

   ```sh
   # Default loopback host (http://127.0.0.1:4005)
   cargo tauri dev

   # Explicit remote HTTPS host
   MSO_DESKTOP_HOST_ORIGIN="https://mso.example.com" cargo tauri dev
   ```

## Stage R1 Real-Machine Verification Checklist

Stage R1 MUST NOT be marked complete until every item below is executed and recorded with real
artifacts on Linux, macOS, and Windows machines:

- [ ] **Linux native build & launch:** `bun run svelte:build` followed by `cargo tauri build` succeeds cleanly; binary launches on desktop without console/CSP errors.
- [ ] **macOS native build & launch:** `.app` / `.dmg` builds cleanly with Xcode CLT; launches cleanly and connects to local loopback and remote HTTPS MSO hosts.
- [ ] **Windows native build & launch:** `.exe` / `.msi` / NSIS bundle builds cleanly on MSVC + WebView2; launches without console window flash (`windows_subsystem = "windows"`).
- [ ] **Bridge & origin enforcement:** Verify `window.__MSO_DESKTOP_SHELL__.mode === "tauri-desktop"`, `window.__MSO_SHELL__.apiBaseOrigin` matches `MSO_DESKTOP_HOST_ORIGIN`, and launching with `MSO_DESKTOP_HOST_ORIGIN="http://mso.example.com"` exits nonzero fail-closed.
- [ ] **Deep-link command safety:** Verify `invoke("resolve_deep_link", { uri: "mso://open/files" })` returns `"/files"`, while `mso://open/api/auth/me` and `mso://open/files?path=../secret` return errors.
- [ ] **CSP & capability enforcement:** Verify DevTools shows zero CSP violations on bundled Svelte assets, API/SSE/WS requests succeed to loopback/HTTPS hosts, and unpermitted Tauri core/fs/shell APIs remain denied.
- [ ] **Window constraints & responsive layout:** Verify initial window size (`1280x820`) and resize down to `360x640` minimum without horizontal overflow across MSO slices.
- [ ] **Workspace isolation intact:** Verify `cd rust-shell && RUSTFLAGS="-D warnings" cargo test --workspace` continues to pass offline without Tauri dependencies.

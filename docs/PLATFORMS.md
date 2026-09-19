# MSO platform support

MSO is **machine-adaptable**, not a collection of unrelated OS forks. The host-capability
layer keeps one Linux runtime contract so terminal, process identity, filesystem safety,
locking, gateway lifecycle and agent execution behave consistently.

The platform adapter decides **where that Linux runtime lives**.

| Machine | Mode | Runtime managed by MSO | Install path |
|---|---|---|---|
| Linux | Native host | The Linux machine itself | canonical POSIX installer |
| macOS | Linux guest host | Lima Linux guest on the Mac | canonical POSIX installer auto-routes to Lima |
| Windows | Linux guest host | WSL2 Linux distro | PowerShell bootstrap |
| Android | Linux guest host | Ubuntu PRoot inside Termux | canonical POSIX installer auto-routes to Termux |
| iOS / iPadOS | Client / PWA | Another MSO host | Safari + Add to Home Screen |

## Why this shape

MSO has host features that are materially Linux-specific today: procfs process identity,
systemd-aware service inventory, kernel-backed file locking and Linux-oriented gateway/process
ownership checks. Pretending those primitives are identical on macOS, Win32, Android or iOS
would produce partial installs that look healthy but fail under real host operations.

The compatibility hosts therefore preserve the same Linux execution environment instead of
duplicating safety logic per OS. This is similar to treating deployment/runtime details as adapters:
the UI and agent surface stay the same, while the machine-specific bootstrap supplies the runtime.

## Linux

Run:

~~~bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
~~~

Linux is the native and fullest host path. systemd is used when it is really PID 1, but the
CLI and foreground/web fallback remain usable on no-systemd hosts such as containers and
hosted workspaces.

## macOS

Run the same public command:

~~~bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
~~~

The bootstrap detects Darwin, verifies `scripts/install-macos.sh`, then creates or reuses a
Lima Linux VM. A `~/.local/bin/mso` launcher on macOS delegates commands into that guest.

Requirements:

- Lima, installed automatically with Homebrew when Homebrew is already available;
- enough disk/RAM for the Linux guest and Next production build.

The MSO host tools manage the **Linux guest**, not native launchd services or arbitrary macOS
processes. That boundary is intentional until native macOS host adapters provide equivalent safety.

## Windows

From PowerShell:

~~~powershell
iwr -useb https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install-windows.ps1 | iex
~~~

The bootstrap installs or reuses WSL2 Ubuntu and runs the canonical Linux installer inside it.
A first-time WSL setup can require a Windows reboot or first-launch Linux user creation; rerun the
same MSO command afterward.

The MSO host tools manage the **WSL2 Linux distro**, not Windows Service Control Manager or
arbitrary Win32 processes.

## Android

From Termux, the canonical command now auto-routes:

~~~bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
~~~

The Android adapter creates or reuses Ubuntu PRoot and exposes a Termux-side `mso` launcher.
No Android root access is required. Because Android may suspend background processes, this is best
for local/personal use; an always-on Linux host is still the stronger production target.

See [TERMUX.md](./TERMUX.md) for repair and PRoot details.

## iOS / iPadOS

iOS/iPadOS is a **first-class client surface**, not a host-runtime target. Open the protected
HTTPS MSO URL in Safari and use **Share → Add to Home Screen**.

This is a technical boundary, not a missing shell theme: iOS does not expose the unrestricted,
persistent Node/Bun host execution and process/service APIs that MSO's host runtime requires.
The iOS shell UI, device approval, terminal, files, agents and MCP-backed workflows still operate
against the connected MSO host.

## Shared invariants

All host paths keep these rules:

- raw MSO bind defaults to `127.0.0.1`;
- Cloudflare, Tailscale, Dokploy and any specific supervisor are optional adapters, not core requirements;
- a missing supervisor must degrade to foreground/fallback runtime rather than make installation impossible;
- platform-specific capability gaps must be reported explicitly;
- installers never claim a guest-controlled service is a native parent-OS service;
- `mso doctor` is the post-install verification surface.

## Verification

On Linux, macOS or Android after the launcher is installed:

~~~bash
mso --version
mso doctor
mso -h
~~~

On Windows, enter WSL2 first and run the same commands there.

The repository test suite pins the five-platform catalog and verifies that the public POSIX
dispatcher still contains macOS and Android routing. This prevents the install UI from regressing
back to a Linux-only presentation.

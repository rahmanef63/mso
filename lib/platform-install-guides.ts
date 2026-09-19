import type { MsoPlatformId } from "./platform-support";

export type PlatformGuideStep = {
  title: string;
  body: string;
  command?: string;
  note?: string;
};

export type PlatformGuideLink = {
  label: string;
  href: string;
  description: string;
};

export type PlatformInstallGuide = {
  id: MsoPlatformId;
  bestFor: string;
  prerequisites: readonly string[];
  steps: readonly PlatformGuideStep[];
  troubleshooting: readonly string[];
  links: readonly PlatformGuideLink[];
};

const INSTALL = "curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash";
const WINDOWS_INSTALL = "iwr -useb https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install-windows.ps1 | iex";
const MSO_REPO = "https://github.com/rahmanef63/mso";
const MSO_PLATFORMS = `${MSO_REPO}/blob/main/docs/PLATFORMS.md`;
const MSO_INSTALL_DOC = `${MSO_REPO}/blob/main/docs/INSTALL.md`;

export const PLATFORM_INSTALL_GUIDES: Record<MsoPlatformId, PlatformInstallGuide> = {
  linux: {
    id: "linux",
    bestFor: "VPS, home server, workstation, container-like Linux hosts, and always-on production.",
    prerequisites: [
      "Use a normal non-root user with sudo when package installation is needed.",
      "Keep about 2 GB free for dependencies and the production build.",
      "The installer handles supported Node/Bun/build prerequisites where possible; manual Node/Bun links are included below for recovery.",
      "Keep the default 127.0.0.1 bind unless you deliberately put a protected HTTPS layer in front.",
    ],
    steps: [
      { title: "Open a terminal as your normal user", body: "Do not switch to root. MSO host actions execute with the runtime user's authority.", command: "whoami\nid -u" },
      { title: "Run the canonical installer", body: "This installs or updates the checkout, validates the CLI, builds production, creates owner auth on first install, and uses systemd only when it is actually available.", command: INSTALL },
      { title: "Complete onboarding", body: "Connect an AI provider, choose the model/preset, and optionally add managed apps or reviewed skills.", command: "mso onboard\nmso skills available" },
      { title: "Verify the host runtime", body: "Doctor should report the actual Linux capabilities instead of assuming the install worked.", command: "mso --version\nmso doctor\nmso -h" },
      { title: "Open the workspace", body: "Start or open the browser workspace. The raw app stays on loopback by default.", command: "mso web", note: "Local browser: http://127.0.0.1:4005" },
      { title: "Add protected remote access when needed", body: "Prefer Tailscale Serve or a named HTTPS reverse-proxy/tunnel. Do not publish the raw shell port directly.", command: "tailscale serve 4005", note: "Cloudflare Tunnel is also supported as an optional gateway adapter; see the official link below." },
    ],
    troubleshooting: [
      "Run mso doctor --fix for safe local repairs, then rerun mso doctor.",
      "If node-pty fails to compile, confirm a C/C++ compiler, make, Python 3, and supported Node are available.",
      "If login loops on a remote IP, use HTTPS or tunnel to localhost; MSO's session cookie is Secure.",
    ],
    links: [
      { label: "MSO install reference", href: MSO_INSTALL_DOC, description: "Canonical flags, update path, TLS and recovery." },
      { label: "Node.js downloads", href: "https://nodejs.org/en/download", description: "Official Node download and supported release information." },
      { label: "Bun installation", href: "https://bun.sh/docs/installation", description: "Official Bun installation and PATH recovery." },
      { label: "Tailscale Serve", href: "https://tailscale.com/docs/features/tailscale-serve", description: "Private HTTPS access inside your tailnet." },
      { label: "Cloudflare Tunnel", href: "https://developers.cloudflare.com/tunnel/get-started/", description: "Named HTTPS tunnel for a stable public hostname." },
    ],
  },
  macos: {
    id: "macos",
    bestFor: "Developers who want MSO locally on a Mac while preserving the same Linux host semantics as a server.",
    prerequisites: [
      "A supported macOS machine with enough RAM/disk for a lightweight Linux VM.",
      "Lima is the compatibility host. If Lima is missing, the bootstrap can install it through Homebrew when Homebrew already exists.",
      "If neither Lima nor Homebrew exists, install Homebrew or Lima first using the official links below.",
      "MSO manages the Lima Linux guest, not native launchd services or arbitrary macOS processes.",
    ],
    steps: [
      { title: "Open Terminal", body: "Use your normal macOS account. You do not need to create a Linux VM manually." },
      { title: "Optional: prepare Lima manually", body: "Skip this when limactl already works. The MSO installer will reuse an existing instance named mso.", command: "command -v limactl >/dev/null || brew install lima" },
      { title: "Run the same MSO installer", body: "The public bootstrap detects Darwin, verifies the macOS adapter, creates/starts Lima, then installs MSO inside its Linux guest.", command: INSTALL },
      { title: "Refresh the current shell if needed", body: "The installer persists ~/.local/bin for future shells; export it manually only when this already-open terminal cannot resolve mso.", command: "export PATH=\"$HOME/.local/bin:$PATH\"\ncommand -v mso" },
      { title: "Verify the guest-backed host", body: "These commands run through the macOS launcher into the Lima guest.", command: "mso --version\nmso doctor" },
      { title: "Open MSO", body: "Start the web workspace, then use the forwarded localhost port from Safari/Chrome on macOS.", command: "mso web", note: "Open http://127.0.0.1:4005 if the browser does not open automatically." },
      { title: "Inspect or recover Lima", body: "Use Lima's CLI when the guest itself needs inspection.", command: "limactl list\nlimactl start mso\nlimactl shell mso" },
    ],
    troubleshooting: [
      "If 'brew: command not found', install Homebrew first or install Lima directly from its official release/documentation.",
      "If 'mso: command not found' immediately after install, export ~/.local/bin into PATH or open a new terminal.",
      "If the guest is stopped after a reboot, the mso launcher starts it automatically; limactl start mso is the manual fallback.",
    ],
    links: [
      { label: "Lima installation", href: "https://lima-vm.io/docs/installation/", description: "Official Lima install methods and host requirements." },
      { label: "Homebrew", href: "https://brew.sh/", description: "Official Homebrew installer used when Lima is absent." },
      { label: "MSO platform contract", href: MSO_PLATFORMS, description: "Why macOS uses a Linux guest instead of partial native host emulation." },
      { label: "MSO source", href: MSO_REPO, description: "Repository, issues and current release source." },
    ],
  },
  windows: {
    id: "windows",
    bestFor: "Windows 10/11 users who want the full MSO host runtime without maintaining a separate VPS.",
    prerequisites: [
      "Windows 10 version 2004+ or Windows 11 for the modern WSL install flow.",
      "WSL2 is the stable MSO host path; the bootstrap reuses a normal existing distro when possible and ignores docker-desktop distros.",
      "Use PowerShell. Administrator elevation is needed when Windows itself still needs WSL installed.",
      "MSO manages the Linux distro inside WSL2, not Windows Service Control Manager or arbitrary Win32 processes.",
    ],
    steps: [
      { title: "Open PowerShell", body: "If WSL is already installed, a normal PowerShell window is enough. If this is the first WSL setup, reopen PowerShell as Administrator." },
      { title: "Run the Windows bootstrap", body: "It finds an existing Linux distro or installs Ubuntu, then runs the canonical MSO Linux installer inside WSL2.", command: WINDOWS_INSTALL },
      { title: "Complete first-time WSL setup when prompted", body: "If the command installed WSL/Ubuntu, restart Windows when requested, launch the distro once, create the Linux username/password, then rerun the same MSO PowerShell command.", command: "wsl --status\nwsl -l -v" },
      { title: "Enter WSL and verify MSO", body: "Use the distro shell for direct diagnostics.", command: "wsl\nexport PATH=\"$HOME/.local/bin:$HOME/.bun/bin:$PATH\"\nmso --version\nmso doctor" },
      { title: "Start/open the workspace", body: "Run from WSL. WSL2 normally forwards Linux localhost services to Windows localhost.", command: "mso web", note: "Open http://localhost:4005 in Edge/Chrome when it does not open automatically." },
      { title: "Recover WSL networking/runtime", body: "Update WSL or restart its VM without touching the MSO repository.", command: "wsl --update\nwsl --shutdown", note: "Reopen the distro, then rerun mso doctor." },
    ],
    troubleshooting: [
      "If wsl.exe is missing, follow Microsoft's WSL installation guide and rerun the MSO bootstrap after the required reboot.",
      "If no distro appears in wsl -l -v, install one with wsl --install -d Ubuntu, complete first launch, then rerun MSO.",
      "If Windows cannot reach port 4005, verify mso web is running inside WSL and review Microsoft's localhost-forwarding documentation.",
    ],
    links: [
      { label: "Install WSL", href: "https://learn.microsoft.com/windows/wsl/install", description: "Microsoft's official WSL installation guide and requirements." },
      { label: "WSL networking", href: "https://learn.microsoft.com/windows/wsl/networking", description: "Official localhost forwarding and networking behavior." },
      { label: "MSO platform contract", href: MSO_PLATFORMS, description: "Windows host scope, WSL2 boundary and shared invariants." },
      { label: "MSO source", href: MSO_REPO, description: "Repository and current installer source." },
    ],
  },
  android: {
    id: "android",
    bestFor: "Portable/local MSO on an Android phone or tablet without root access.",
    prerequisites: [
      "Install a current Termux build from F-Droid or the official Termux GitHub releases.",
      "No Android root access is required.",
      "The adapter runs Ubuntu in PRoot because native Android/Termux does not provide the exact Linux/Bun/native-module runtime MSO expects.",
      "Android battery/background policies can suspend long-running processes, so an always-on Linux host remains preferable for production.",
    ],
    steps: [
      { title: "Install and open Termux", body: "Use F-Droid or the official Termux project release links below. Do not mix plugin/app signing sources." },
      { title: "Run the canonical installer", body: "The public MSO bootstrap detects Termux, repairs/updates required packages, installs/reuses Ubuntu PRoot, creates a non-root guest owner, and installs the Termux-side mso launcher.", command: INSTALL },
      { title: "Verify the launcher and guest", body: "The mso launcher automatically enters the Ubuntu guest, so normal commands stay identical to Linux.", command: "mso --version\nmso doctor\nmso -h" },
      { title: "Complete onboarding", body: "Configure your model/provider from the same terminal flow.", command: "mso onboard" },
      { title: "Open the browser workspace", body: "Run the web command from Termux and open the local URL in your Android browser.", command: "mso web", note: "Open http://127.0.0.1:4005 on the same device." },
      { title: "Inspect the Ubuntu guest when needed", body: "This is for low-level recovery; routine MSO use should stay on the mso launcher.", command: "proot-distro login mso-ubuntu --user mso" },
    ],
    troubleshooting: [
      "If Termux package operations fail, run apt update && apt full-upgrade -y; use termux-change-repo if the selected mirror is unavailable.",
      "If curl cannot start after a partial upgrade, reinstall the Termux OpenSSL/curl package set as documented in MSO's TERMUX.md.",
      "If Android kills the process in the background, adjust battery optimization for Termux or move the always-on host to Linux/VPS.",
    ],
    links: [
      { label: "Termux on F-Droid", href: "https://f-droid.org/packages/com.termux/", description: "F-Droid package page for Termux." },
      { label: "Official Termux project", href: "https://github.com/termux/termux-app", description: "Official installation notes and GitHub releases." },
      { label: "PRoot-Distro", href: "https://github.com/termux/proot-distro", description: "Rootless Linux userland used by the Android adapter." },
      { label: "MSO Android guide", href: `${MSO_REPO}/blob/main/docs/TERMUX.md`, description: "MSO-specific repair, guest and verification details." },
    ],
  },
  ios: {
    id: "ios",
    bestFor: "Using MSO from iPhone/iPad as an operator console, PWA, terminal and agent client.",
    prerequisites: [
      "You need an MSO host running on Linux, macOS/Lima, Windows/WSL2, or Android/PRoot.",
      "For remote use, expose MSO through a protected HTTPS hostname. Plain HTTP to a remote server IP cannot persist MSO's Secure session cookie.",
      "iOS/iPadOS is intentionally a client surface; it does not run the unrestricted persistent Node/Bun host runtime.",
    ],
    steps: [
      { title: "Prepare an MSO host", body: "Install MSO on one of the host-capable platforms first and verify it with mso doctor.", command: "mso doctor" },
      { title: "Give the host a safe URL", body: "Use Tailscale Serve for private access or a stable HTTPS reverse proxy/named tunnel for public access.", command: "tailscale serve 4005", note: "Keep the raw MSO listener on 127.0.0.1." },
      { title: "Open MSO in Safari", body: "Navigate to the protected HTTPS MSO URL and sign in with the owner password." },
      { title: "Approve the iPhone/iPad device", body: "From an already-approved owner terminal/device, approve the pending browser device ID.", command: "mso device pending\nmso device approve <deviceId> \"my iPhone\"" },
      { title: "Install the PWA", body: "In Safari tap Page Menu/Share → Add to Home Screen → enable Open as Web App → Add. Apple documents this exact flow in the link below." },
      { title: "Use MSO like an app", body: "Launch it from the Home Screen. The iOS shell, terminal, files, agents and workflows operate against the connected MSO host." },
    ],
    troubleshooting: [
      "If login repeats, verify the URL is HTTPS and do not switch between server IP, tunnel hostname and another origin during device pairing.",
      "If Add to Home Screen is missing, Apple advises using Share → Edit Actions and enabling Add to Home Screen.",
      "If the host is unreachable, diagnose the host/tunnel first; the iOS app surface cannot start a remote host that is offline.",
    ],
    links: [
      { label: "Apple: turn a website into an app", href: "https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios", description: "Official Add to Home Screen / Open as Web App steps." },
      { label: "Tailscale Serve", href: "https://tailscale.com/docs/features/tailscale-serve", description: "Private HTTPS access from your tailnet." },
      { label: "Cloudflare Tunnel", href: "https://developers.cloudflare.com/tunnel/get-started/", description: "Stable HTTPS hostname without exposing the raw MSO port." },
      { label: "MSO platform contract", href: MSO_PLATFORMS, description: "Why iOS/iPadOS is a client rather than a host runtime." },
    ],
  },
};

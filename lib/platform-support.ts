export type MsoPlatformId = "linux" | "macos" | "windows" | "android" | "ios";
export type MsoPlatformMode = "native-host" | "linux-guest-host" | "client";

export type MsoPlatformSupport = {
  id: MsoPlatformId;
  label: string;
  mode: MsoPlatformMode;
  modeLabel: string;
  summary: string;
  installCommand?: string;
  verifyCommand?: string;
  hostScope: string;
  notes: readonly string[];
};

const RAW = "https://raw.githubusercontent.com/rahmanef63/mso/main/scripts";
const POSIX_INSTALL = `curl -fsSL ${RAW}/install.sh | bash`;

export const PLATFORM_SUPPORT: readonly MsoPlatformSupport[] = [
  {
    id: "linux",
    label: "Linux",
    mode: "native-host",
    modeLabel: "Native host",
    summary: "Runs the canonical MSO runtime directly as a non-root Linux process.",
    installCommand: POSIX_INSTALL,
    verifyCommand: "mso doctor",
    hostScope: "This Linux machine",
    notes: ["Full host-runtime path.", "systemd is optional for the CLI/web fallback runtime.", "Binds 127.0.0.1 by default."],
  },
  {
    id: "macos",
    label: "macOS",
    mode: "linux-guest-host",
    modeLabel: "Host via Lima",
    summary: "The public installer detects macOS, creates or reuses a Lima Linux VM, and delegates the mso CLI into it.",
    installCommand: POSIX_INSTALL,
    verifyCommand: "mso doctor",
    hostScope: "Linux guest on this Mac",
    notes: ["Keeps /proc, PTY, locking and process semantics consistent.", "Lima handles localhost forwarding between guest and Mac."],
  },
  {
    id: "windows",
    label: "Windows",
    mode: "linux-guest-host",
    modeLabel: "Host via WSL2",
    summary: "The PowerShell bootstrap installs or reuses WSL2 Ubuntu, then runs the canonical MSO Linux installer there.",
    installCommand: `iwr -useb ${RAW}/install-windows.ps1 | iex`,
    verifyCommand: "Open WSL2, then run: mso doctor",
    hostScope: "Linux distro inside WSL2",
    notes: ["WSL2 is the stable Windows host path.", "First-time WSL setup can require a reboot or Ubuntu first-run before rerunning MSO."],
  },
  {
    id: "android",
    label: "Android",
    mode: "linux-guest-host",
    modeLabel: "Host via Termux + Ubuntu PRoot",
    summary: "The public installer detects Termux, creates or reuses Ubuntu PRoot, and exposes a Termux-side mso launcher.",
    installCommand: POSIX_INSTALL,
    verifyCommand: "mso doctor",
    hostScope: "Ubuntu PRoot guest on this Android device",
    notes: ["No Android root access is required.", "Android battery/background policy can suspend long-running local hosts."],
  },
  {
    id: "ios",
    label: "iOS / iPadOS",
    mode: "client",
    modeLabel: "PWA / client",
    summary: "Uses the full MSO browser workspace against another MSO host; native host execution is not claimed on iOS/iPadOS.",
    hostScope: "Remote MSO host",
    notes: ["Open the protected HTTPS MSO URL in Safari and Add to Home Screen.", "iPhone/iPad remains the operator surface; host execution stays on a supported MSO host."],
  },
] as const;

export function platformSupport(id: MsoPlatformId): MsoPlatformSupport {
  const entry = PLATFORM_SUPPORT.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown MSO platform: ${id}`);
  return entry;
}

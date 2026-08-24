// What each upstream CLI actually offers, read off `--help` on this host
// (2026-07-25). Used ONLY as the fallback when the route sends no
// `capabilities` block — a server that declares its own support wins, because
// it is the side that builds the argv.
//
//   hermes update  → --check --backup/--no-backup --yes --branch NAME --force
//                    (no dry-run verb; `--check` is the read-only probe)
//   hermes uninstall → --full --yes --dry-run
//   openclaw update  → --yes --json --dry-run --channel stable|extended-stable|beta|dev
//                      --tag <dist-tag|version|spec> --no-restart --timeout
//   openclaw uninstall → --non-interactive --yes --dry-run --service --state
//                        --workspace --all
import type { ManagedAppId } from "@/lib/managed-apps/types";

export interface AppSupport {
  /** A real, non-mutating rehearsal of the update. Only OpenClaw has one.
   *  Channels are NOT mirrored here: whether one can be switched is the
   *  server's call (`channel.switchable`), never a guess from this table. */
  dryRun: boolean;
  /** Can a version be pinned as PART of a rollback? Mirrors `UpdateAdapter.pin`
   *  (update-cli.ts), which is null for Hermes — its pin switches the git
   *  checkout and would auto-stash the files the restore just wrote back. */
  rollbackPin: boolean;
  /** How this app pins a version when rolling back — or, when `rollbackPin` is
   *  false, what to do instead. */
  pinLabel: string;
  pinHint: string;
  pinPlaceholder: string;
  /** The by-hand command, kept even though MSO now installs for real: a button
   *  that fails on someone else's machine and leaves them with nothing is worse
   *  than the copy-paste it replaced. The automated path is
   *  scripts/managed-app-install; this is what it does, written out. */
  installCommand: string;
  installNote: string;
  uninstallCommand: string;
  uninstallEffect: string;
  stateDir: string;
}

const SUPPORT: Record<ManagedAppId, AppSupport> = {
  hermes: {
    dryRun: false,
    rollbackPin: false,
    pinLabel: "Branch",
    pinHint:
      "Hermes has no version pin. `update --branch NAME` switches the checkout and auto-stashes local changes — and a restore leaves ~/.hermes dirty against an unchanged HEAD, so it would stash the files just restored. Switch the branch from the Update tab afterwards if you meant to move the code.",
    pinPlaceholder: "main",
    installCommand:
      "curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/h.sh && bash /tmp/h.sh --non-interactive && hermes setup --non-interactive && hermes gateway install --start-now",
    installNote:
      "The installer pulls uv, Python 3.11, Node and ffmpeg — expect several minutes. `--non-interactive` skips every stage that would ask a question, and `hermes setup` then takes its API key from the environment instead of a prompt.",
    uninstallCommand: "hermes uninstall --yes",
    uninstallEffect:
      "Removes Hermes but keeps ~/.hermes config and data (add --full to remove those too). `hermes uninstall --dry-run` prints what it would remove.",
    stateDir: "~/.hermes",
  },
  openclaw: {
    dryRun: true,
    rollbackPin: true,
    pinLabel: "Version",
    pinHint: "OpenClaw pins with `update --tag` — an exact version, or one of latest/stable/extended-stable/beta/dev. Package specs (a fork, a git ref) are refused.",
    pinPlaceholder: "2026.7.1-2",
    installCommand:
      "npm install -g openclaw@latest && openclaw onboard --non-interactive --accept-risk --flow quickstart --gateway-auth token --gateway-bind loopback --install-daemon",
    installNote:
      "`npm i -g` needs no sudo where npm's prefix is a user directory. `onboard --non-interactive` requires `--accept-risk` — the acknowledgement that an agent with system access is a loaded gun — and binds the gateway to loopback unless told otherwise.",
    uninstallCommand: "openclaw uninstall --non-interactive --yes --service --state",
    uninstallEffect:
      "Removes the gateway service and local state; the `openclaw` CLI itself stays on PATH. `--dry-run` prints the actions, `--all` also removes the workspace.",
    stateDir: "~/.openclaw",
  },
  "9router": {
    dryRun: false,
    rollbackPin: false,
    pinLabel: "Version",
    pinHint:
      "9Router ships one Docker tag (latest), so there is no version pin. A rollback restores the ~/.9router data snapshot; the image stays whatever is installed. Running an older image is a by-hand `docker run` with an explicit tag.",
    pinPlaceholder: "0.5.55",
    installCommand:
      "docker run -d --name 9router --restart unless-stopped -p 20128:20128 -v ~/.9router:/app/data -e DATA_DIR=/app/data decolua/9router:latest",
    installNote:
      "Pulls the decolua/9router image and starts it on port 20128 with its data in ~/.9router. Needs a user in the docker group; no sudo, no systemd unit — Docker's restart policy keeps it up.",
    uninstallCommand: "docker rm -f 9router",
    uninstallEffect:
      "Stops and removes the container. The image and ~/.9router data (providers, keys, stats) stay, so a reinstall comes back configured.",
    stateDir: "~/.9router",
  },
};

export const supportFor = (id: ManagedAppId): AppSupport => SUPPORT[id];

/** Bytes → a size a human reads at a glance. Backups here are 200–400 MB. */
export function fmtBytes(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** ISO → local, or the raw string when it is not a date we can parse. */
export function fmtStamp(value: string | null): string {
  if (!value) return "—";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
}

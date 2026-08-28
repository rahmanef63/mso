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
   *  than the copy-paste it replaced. These commands call the same committed,
   *  checksum-verifying installer used by the API. */
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
    installCommand: "bash scripts/managed-app-install hermes install",
    installNote:
      "MSO downloads the reviewed Hermes release installer from its pinned tag, verifies SHA-256, and forces the checkout to the locked upstream commit before setup. The immutable values live in security/managed-app-artifacts.env.",
    uninstallCommand: "hermes uninstall --yes",
    uninstallEffect:
      "Removes Hermes but keeps ~/.hermes config and data (add --full to remove those too). `hermes uninstall --dry-run` prints what it would remove.",
    stateDir: "~/.hermes",
  },
  openclaw: {
    dryRun: true,
    rollbackPin: true,
    pinLabel: "Version",
    pinHint: "Rollback accepts an exact reviewed OpenClaw version. Moving channels or mutable dist-tags is an explicit update action, not the install default.",
    pinPlaceholder: "2026.7.1-2",
    installCommand: "bash scripts/managed-app-install openclaw install",
    installNote:
      "MSO downloads the exact OpenClaw tarball named in security/managed-app-artifacts.env, verifies SHA-512 before npm can run lifecycle hooks, and confirms the installed version before onboarding it on loopback.",
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
      "MSO installs one reviewed multi-architecture image digest. Update reconciles the container to the digest committed in security/managed-app-artifacts.env; rollback restores data, not an unreviewed tag.",
    pinPlaceholder: "sha256:f00fe389…",
    installCommand: "bash scripts/managed-app-9router install",
    installNote:
      "MSO pulls and verifies the committed 9Router digest, binds 20128 to loopback by default, and stores data in ~/.9router. Set NINE_ROUTER_EXPOSE_PUBLIC=1 only for an explicitly accepted public-IP deployment.",
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
